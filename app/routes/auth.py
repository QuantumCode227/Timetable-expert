from flask import Blueprint, render_template, redirect, url_for, flash
from werkzeug.security import check_password_hash
from flask_login import login_user, logout_user, login_required
from app.forms import LoginForm
from app.models import User


auth_bp = Blueprint("auth", __name__)


# Login locic
@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    form = LoginForm()
    if form.validate_on_submit():
        email = form.email.data
        password = form.password.data
        user = User.query.filter_by(email=email).first()
        if user:
            if check_password_hash(user.password, password):
                login_user(user)
                return redirect(url_for("main.index"))
            else:
                flash("Invalid password", "error")
                return redirect(url_for("auth.login"))
        else:
            flash("User not exist", "error")
            return redirect(url_for("auth.login"))
    return render_template("login.html", form=form)


# Logout logic
@auth_bp.route("/logout", methods=["POST", "GET"])
@login_required
def logout():
    logout_user()
    return redirect(url_for("auth.login"))
