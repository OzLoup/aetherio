from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.auth import create_access_token, get_current_user, hash_password, verify_password
from app.config import settings
from app.database import get_db
from app.models import Profile, User
from app.parental import check_pin
from app.schemas import PasswordChange, PinSet, PinVerify, Token, UserCreate, UserLogin, UserOut, UserUpdate

router = APIRouter(prefix="/auth", tags=["auth"])

oauth = OAuth()
oauth.register(
    name="google",
    client_id=settings.google_client_id,
    client_secret=settings.google_client_secret,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


def _first_profile(user: User) -> Profile:
    """Every account starts with one profile, named after its owner. No
    addons are preinstalled: each profile installs its own."""
    first_name = (user.name or "").strip().split(" ")[0]
    return Profile(user_id=user.id, name=(first_name or "Principal")[:50])


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="Ese email ya está registrado")

    user = User(email=payload.email, name=payload.name, hashed_password=hash_password(payload.password))
    db.add(user)
    db.flush()
    db.add(_first_profile(user))
    db.commit()

    return Token(access_token=create_access_token(user.email))


@router.post("/login", response_model=Token)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not user.hashed_password or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Credenciales inválidas")

    return Token(access_token=create_access_token(user.email))


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        has_password=bool(user.hashed_password),
        google_linked=bool(user.google_id),
        has_pin=bool(user.parental_pin_hash),
    )


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return _user_out(current_user)


@router.patch("/me", response_model=UserOut)
def update_me(payload: UserUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.name is not None:
        current_user.name = payload.name.strip() or None
    db.commit()
    return _user_out(current_user)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(payload: PasswordChange, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.hashed_password:
        if not payload.current_password or not verify_password(payload.current_password, current_user.hashed_password):
            raise HTTPException(status_code=400, detail="La contraseña actual no es correcta")
    current_user.hashed_password = hash_password(payload.new_password)
    db.commit()


# ---------- Google OAuth2 ----------


@router.get("/providers")
def providers():
    """Which login methods this server has configured (the UI hides the rest)."""
    return {"google": bool(settings.google_client_id and settings.google_client_secret)}


def _login_redirect(client: str | None, fragment: str) -> RedirectResponse:
    """Back to the app that started the login: the website, or the macOS app
    through its aetherio:// URL scheme (the system browser opens it)."""
    base = settings.desktop_auth_redirect if client == "desktop" else f"{settings.frontend_url}/auth/callback"
    return RedirectResponse(url=f"{base}#{fragment}")


@router.get("/google/login")
async def google_login(request: Request, client: str = "web"):
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(
            status_code=501,
            detail="Google OAuth no está configurado. Define GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en el .env.",
        )
    request.session["oauth_client"] = "desktop" if client == "desktop" else "web"
    return await oauth.google.authorize_redirect(request, settings.google_redirect_uri)


@router.get("/google/callback")
async def google_callback(request: Request, db: Session = Depends(get_db)):
    client = request.session.pop("oauth_client", "web")
    try:
        token = await oauth.google.authorize_access_token(request)
    except Exception:  # user cancelled, expired state, etc.
        return _login_redirect(client, "error=google")
    userinfo = token.get("userinfo") or {}
    # Only link accounts by email when Google vouches for that email.
    if not userinfo.get("email") or not userinfo.get("email_verified", False):
        return _login_redirect(client, "error=google_email")

    email = userinfo["email"].lower()
    google_id = userinfo["sub"]
    name = userinfo.get("name")

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        user = User(email=email, name=name, google_id=google_id)
        db.add(user)
        db.flush()
        db.add(_first_profile(user))
        db.commit()
    elif not user.google_id:
        user.google_id = google_id
        db.commit()

    # Token in the URL fragment: never reaches server logs or browser history.
    return _login_redirect(client, f"token={create_access_token(user.email)}")


# ---------- Parental control PIN ----------


@router.put("/pin", status_code=status.HTTP_204_NO_CONTENT)
def set_pin(payload: PinSet, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.parental_pin_hash:
        by_password = bool(
            payload.password
            and current_user.hashed_password
            and verify_password(payload.password, current_user.hashed_password)
        )
        if not by_password:
            if not payload.current_pin:
                raise HTTPException(status_code=403, detail="El PIN actual o la contraseña no son correctos")
            check_pin(current_user, payload.current_pin)  # 403/429 when wrong
    current_user.parental_pin_hash = hash_password(payload.pin)
    db.commit()


@router.post("/pin/verify", status_code=status.HTTP_204_NO_CONTENT)
def verify_pin(payload: PinVerify, current_user: User = Depends(get_current_user)):
    check_pin(current_user, payload.pin)
