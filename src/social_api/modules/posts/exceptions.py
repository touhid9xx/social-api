"""Posts/comments/likes shared exceptions."""

from __future__ import annotations

from social_api.exceptions import AppError


class PostNotFoundError(AppError):
    code = "POST_NOT_FOUND"
    status_code = 404
    message = "Post not found"


class CommentNotFoundError(AppError):
    code = "COMMENT_NOT_FOUND"
    status_code = 404
    message = "Comment not found"


class PostForbiddenError(AppError):
    code = "POST_FORBIDDEN"
    status_code = 403
    message = "You cannot modify this post"


class CommentForbiddenError(AppError):
    code = "COMMENT_FORBIDDEN"
    status_code = 403
    message = "You cannot modify this comment"


class CommentDepthExceededError(AppError):
    code = "COMMENT_DEPTH_EXCEEDED"
    status_code = 400
    message = "Reply nesting depth exceeded (max 2)"


class LikeTargetNotFoundError(AppError):
    code = "LIKE_TARGET_NOT_FOUND"
    status_code = 404
    message = "Like target not found"
