from flask_wtf import FlaskForm
from wtforms import EmailField, PasswordField, SubmitField, StringField
from wtforms.validators import DataRequired, Email, Length, Optional


class LoginForm(FlaskForm):
    email = EmailField("Email", validators=[DataRequired(), Email()])
    password = PasswordField("Password", validators=[DataRequired(), Length(min=5)])
    login = SubmitField("Login")


class SettingsForm(FlaskForm):
    username = StringField("Username", validators=[Optional()])
    email = EmailField("Email", validators=[Email(), Optional()])
    current_password = PasswordField(
        "Current Password", validators=[Optional(), Length(min=5)]
    )
    new_password = PasswordField("New Password", validators=[Optional(), Length(min=5)])
    confirm_password = PasswordField(
        "Confirm Password", validators=[Optional(), Length(min=5)]
    )
    api_key = StringField("New API Key", validators=[Optional(), Length(min=5)])
    button = SubmitField("Button")
