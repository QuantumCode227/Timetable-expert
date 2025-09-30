from app import db
from app.models import User

# create user
u = User(username="awais", email="abbaxiawaix0@gmail.com")
u.set_password("admin1234!")
db.session.add(u)
db.session.commit()

# verify
User.query.filter_by(username="awaix").first()
