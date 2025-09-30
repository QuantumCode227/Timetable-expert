from flask import Blueprint, render_template, flash, redirect, url_for
from werkzeug.security import check_password_hash, generate_password_hash
from app.services.timetable_services import fetch_timetable_data, build_maps_and_grids
from flask import current_app as app
from flask_login import current_user, login_required
from app.forms import SettingsForm
from app.models import User
from app import db

main_bp = Blueprint("main", __name__)


@main_bp.route("/")
@login_required
def index():
    raw = fetch_timetable_data()
    if not raw:
        return "<h3 style='color:red'>Error: could not fetch timetable from API. Check API_KEY and connectivity.</h3>"
    prepared = build_maps_and_grids(raw)
    return render_template("timetable.html", data=prepared)


@main_bp.route("/settings", methods=["POST", "GET"])
@login_required
def settings():
    form = SettingsForm()
    if form.validate_on_submit():
        username = form.username.data
        email = form.email.data
        current_password = form.current_password.data
        new_password = form.new_password.data
        confirm_password = form.confirm_password.data
        api_key = form.api_key.data

        user = current_user
        updated = False  

        if current_password or new_password or confirm_password:
            # require all three to be present
            if not (current_password and new_password and confirm_password):
                flash(
                    "To change password, provide current, new and confirm fields.",
                    "warning",
                )
                return redirect(url_for("main.settings"))

            # Ensure hashed password exists on user
            if not user.password:
                flash("No password is set for this account.", "error")
                return redirect(url_for("main.settings"))

            if check_password_hash(user.password, current_password):
                if new_password == confirm_password:
                    user.password = generate_password_hash(new_password)
                    db.session.commit()
                    flash("Password updated successfully", "success")
                    return redirect(url_for("main.settings"))
                else:
                    flash("New passwords do not match.", "error")
                    return redirect(url_for("main.settings"))
            else:
                flash("Incorrect current password.", "error")
                return redirect(url_for("main.settings"))
            
        # API key update logic

        if api_key:
            user.api_key = api_key
            db.session.commit()
            flash("API key updated successfully", "success")
            return redirect(url_for("main.settings"))

        if username:
            # Check if entered username is taken by another user
            existing = User.query.filter_by(username=username).first()
            if existing and existing.id != user.id:
                flash("Username already taken.", "warning")
                return redirect(url_for("main.settings"))
            if user.username != username:
                user.username = username
                db.session.commit()
                flash("Username updated successfully", "success")
                return redirect(url_for("main.settings"))
            else:
                flash("No change to username.", "info")
                return redirect(url_for("main.settings"))

        #  Email update logic
        if email:
            # Basic uniqueness check excluding current user
            existing = User.query.filter_by(email=email).first()
            if existing and existing.id != user.id:
                flash("Email already taken.", "warning")
                return redirect(url_for("main.settings"))
            if user.email != email:
                user.email = email
                db.session.commit()
                flash("Email updated successfully", "success")
                return redirect(url_for("main.settings"))
            else:
                flash("No change to email.", "info")
                return redirect(url_for("main.settings"))

        flash("No changes submitted.", "info")

    return render_template("settings.html", form=form)
