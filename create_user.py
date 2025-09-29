from app import db
from app.models import User

# create user
u = User(username="awaix", email="awaix@example.com")
u.set_password("MyStrongPassword1!")
db.session.add(u)
db.session.commit()

# verify
User.query.filter_by(username="awaix").first()
