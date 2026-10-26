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
