"""Chat errors."""

from __future__ import annotations

from social_api.exceptions import AppError


class ChatRoomNotFoundError(AppError):
    code = "CHAT_ROOM_NOT_FOUND"
    status_code = 404
    message = "Chat room not found"


class ChatRoomForbiddenError(AppError):
    code = "CHAT_ROOM_FORBIDDEN"
    status_code = 403
    message = "You are not a member of this chat room"


class CannotChatWithSelfError(AppError):
    code = "CANNOT_CHAT_WITH_SELF"
    status_code = 400
    message = "You cannot create a direct chat with yourself"


class UserBlockedChatError(AppError):
    code = "CHAT_BLOCKED"
    status_code = 403
    message = "You cannot chat with this user"


class MessageNotFoundError(AppError):
    code = "MESSAGE_NOT_FOUND"
    status_code = 404
    message = "Message not found"


class MessageForbiddenError(AppError):
    code = "MESSAGE_FORBIDDEN"
    status_code = 403
    message = "You cannot modify this message"


class ReadReceiptInvalidError(AppError):
    code = "READ_RECEIPT_INVALID"
    status_code = 400
    message = "Read receipt message ID is not in this room or is ahead of the latest"


class GroupChatNotAllowedError(AppError):
    code = "GROUP_CHAT_NOT_ALLOWED"
    status_code = 400
    message = "This operation is only valid on group rooms"


class DirectChatNotAllowedError(AppError):
    code = "DIRECT_CHAT_NOT_ALLOWED"
    status_code = 400
    message = "This operation is only valid on direct rooms"


class AdminRequiredError(AppError):
    code = "ADMIN_REQUIRED"
    status_code = 403
    message = "Admin role required for this operation"


class LastAdminCannotLeaveError(AppError):
    code = "LAST_ADMIN_CANNOT_LEAVE"
    status_code = 409
    message = "You are the last admin — promote another member before leaving"


class AlreadyMemberError(AppError):
    code = "ALREADY_MEMBER"
    status_code = 409
    message = "User is already a member of this room"


class MediaNotOwnedError(AppError):
    code = "MEDIA_NOT_OWNED"
    status_code = 403
    message = "You can only attach your own uploads"


class MediaAlreadyUsedError(AppError):
    code = "MEDIA_ALREADY_USED"
    status_code = 409
    message = "Media is already attached to a post or message"
