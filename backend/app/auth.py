from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Profile, User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(subject: str, version: int = 0) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": subject, "exp": expire, "iat": now, "ver": version}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> tuple[str, int] | None:
    """(email, token version). Tokens from before versions count as 0."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None
    sub = payload.get("sub")
    ver = payload.get("ver", 0)
    if not isinstance(sub, str) or not isinstance(ver, int):
        return None
    return sub, ver


def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudo validar la sesión",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if token is None:
        raise credentials_exception

    decoded = decode_access_token(token)
    if decoded is None:
        raise credentials_exception
    email, version = decoded

    user = db.query(User).filter(User.email == email).first()
    # A password change bumps token_version: older sessions are out.
    if user is None or version != (user.token_version or 0):
        raise credentials_exception
    return user


def get_current_profile(
    x_profile_id: int | None = Header(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Profile:
    """The profile the client is acting as, sent in the `X-Profile-Id` header.
    Must belong to the logged-in account."""
    if x_profile_id is None:
        raise HTTPException(status_code=400, detail="Elige un perfil")
    profile = db.get(Profile, x_profile_id)
    if profile is None or profile.user_id != user.id:
        raise HTTPException(status_code=404, detail="Perfil no encontrado")
    return profile
