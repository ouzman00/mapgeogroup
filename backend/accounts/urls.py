from django.urls import path

from .views import (
    AdminClientCreateView,
    ChangePasswordView,
    ClientActivationConfirmView,
    ClientActivationValidateView,
    ForgotPasswordView,
    GoogleLoginView,
    LoginView,
    LogoutView,
    ProfileView,
    RegisterView,
    ResetPasswordConfirmView,
    ResetPasswordValidateView,
    UserAccessActionView,
    UserDetailView,
    UserInviteView,
    UserListView,
    CurrentUserAvatarView,
)

urlpatterns = [
    path("me/avatar/", CurrentUserAvatarView.as_view(), name="me-avatar"),
    path("login/", LoginView.as_view(), name="login"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("register/", RegisterView.as_view(), name="register"),
    path("profile/", ProfileView.as_view(), name="profile"),
    path("change-password/", ChangePasswordView.as_view(), name="change-password"),
    path("forgot-password/", ForgotPasswordView.as_view(), name="forgot-password"),
    path("reset-password/<str:uid>/<str:token>/", ResetPasswordValidateView.as_view(), name="reset-password-validate"),
    path("reset-password/confirm/", ResetPasswordConfirmView.as_view(), name="reset-password-confirm"),
    path("google/login/", GoogleLoginView.as_view(), name="google-login"),

    path("clients/", AdminClientCreateView.as_view(), name="admin-client-create"),
    path(
        "clients/activation/<str:uid>/<str:token>/",
        ClientActivationValidateView.as_view(),
        name="client-activation-validate",
    ),
    path(
        "clients/activation/confirm/",
        ClientActivationConfirmView.as_view(),
        name="client-activation-confirm",
    ),

    path("users/", UserListView.as_view(), name="users-list"),
    path("users/invite/", UserInviteView.as_view(), name="user-invite"),
    path("users/<int:pk>/", UserDetailView.as_view(), name="user-detail"),
    path("users/<int:pk>/<str:action>/", UserAccessActionView.as_view(), name="user-access-action"),

    path("", UserListView.as_view(), name="users-list-legacy"),
]