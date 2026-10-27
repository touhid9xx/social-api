# Social API — API Reference

Version: `0.1.0`

Base URL: `/`

---

## Endpoints

### `GET` /api/v1/audit

**Summary:** List All Audit

**Tags:** audit

**operationId:** `list_all_audit_api_v1_audit_get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| actor_id | query | False | `{"anyOf": [{"type": "integer"}, {"type": "null"}], "title": "Actor Id"}` |
| action | query | False | `{"anyOf": [{"enum": ["REGISTER", "LOGIN", "LOGOUT", "PROFILE_UPDATE", "DELETE_POST", "DELETE_COMMENT", "BLOCK", "UNBLOCK", "MUTE", "UNMUTE", "CREATE_CHAT_GROUP", "UPDATE_CHAT_GROUP_TITLE", "ADD_CHAT_MEMBER", "REMOVE_CHAT_MEMBER", "DELETE_CHAT_MESSAGE", "MODERATION_STATUS_UPDATE"], "type": "string"}, {"type": "null"}], "title": "Action"}` |
| entity | query | False | `{"anyOf": [{"enum": ["user", "profile", "post", "comment", "message", "chat_room", "report"], "type": "string"}, {"type": "null"}], "title": "Entity"}` |
| entity_id | query | False | `{"anyOf": [{"type": "integer"}, {"type": "null"}], "title": "Entity Id"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 100, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/audit/me

**Summary:** My Audit

**Tags:** audit

**operationId:** `my_audit_api_v1_audit_me_get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| action | query | False | `{"anyOf": [{"enum": ["REGISTER", "LOGIN", "LOGOUT", "PROFILE_UPDATE", "DELETE_POST", "DELETE_COMMENT", "BLOCK", "UNBLOCK", "MUTE", "UNMUTE", "CREATE_CHAT_GROUP", "UPDATE_CHAT_GROUP_TITLE", "ADD_CHAT_MEMBER", "REMOVE_CHAT_MEMBER", "DELETE_CHAT_MESSAGE", "MODERATION_STATUS_UPDATE"], "type": "string"}, {"type": "null"}], "title": "Action"}` |
| entity | query | False | `{"anyOf": [{"enum": ["user", "profile", "post", "comment", "message", "chat_room", "report"], "type": "string"}, {"type": "null"}], "title": "Entity"}` |
| entity_id | query | False | `{"anyOf": [{"type": "integer"}, {"type": "null"}], "title": "Entity Id"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 100, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/auth/login

**Summary:** Login

**Tags:** auth

**operationId:** `login_api_v1_auth_login_post`


**Request Body:**

- `application/json` -> `#/components/schemas/LoginRequest`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/auth/logout

**Summary:** Logout

**Tags:** auth

**operationId:** `logout_api_v1_auth_logout_post`

**Auth:** [{"HTTPBearer": []}]


**Responses:**

- `204` — Successful Response

---

### `GET` /api/v1/auth/me

**Summary:** Me

**Tags:** auth

**operationId:** `me_api_v1_auth_me_get`

**Auth:** [{"HTTPBearer": []}]


**Responses:**

- `200` — Successful Response

---

### `POST` /api/v1/auth/refresh

**Summary:** Refresh

**Tags:** auth

**operationId:** `refresh_api_v1_auth_refresh_post`


**Request Body:**

- `application/json` -> `#/components/schemas/RefreshRequest`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/auth/register

**Summary:** Register

**Tags:** auth

**operationId:** `register_api_v1_auth_register_post`


**Request Body:**

- `application/json` -> `#/components/schemas/RegisterRequest`


**Responses:**

- `201` — Successful Response
- `422` — Validation Error

---

### `DELETE` /api/v1/blocks/{user_id}

**Summary:** Unblock

**Tags:** follows

**operationId:** `unblock_api_v1_blocks__user_id__delete`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/blocks/{user_id}

**Summary:** Block

**Tags:** follows

**operationId:** `block_api_v1_blocks__user_id__post`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error

---

### `DELETE` /api/v1/chat/messages/{message_id}

**Summary:** Delete Message

**Tags:** chat

**operationId:** `delete_message_api_v1_chat_messages__message_id__delete`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| message_id | path | True | `{"type": "integer", "title": "Message Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/chat/rooms

**Summary:** List My Rooms

**Tags:** chat

**operationId:** `list_my_rooms_api_v1_chat_rooms_get`

**Auth:** [{"HTTPBearer": []}]


**Responses:**

- `200` — Successful Response

---

### `POST` /api/v1/chat/rooms/direct

**Summary:** Create Direct Room

**Tags:** chat

**operationId:** `create_direct_room_api_v1_chat_rooms_direct_post`

**Auth:** [{"HTTPBearer": []}]


**Request Body:**

- `application/json` -> `#/components/schemas/DirectRoomCreate`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/chat/rooms/group

**Summary:** Create Group

**Tags:** chat

**operationId:** `create_group_api_v1_chat_rooms_group_post`

**Auth:** [{"HTTPBearer": []}]


**Request Body:**

- `application/json` -> `#/components/schemas/GroupRoomCreate`


**Responses:**

- `201` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/chat/rooms/{room_id}

**Summary:** Get Room

**Tags:** chat

**operationId:** `get_room_api_v1_chat_rooms__room_id__get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `PATCH` /api/v1/chat/rooms/{room_id}

**Summary:** Update Room

**Tags:** chat

**operationId:** `update_room_api_v1_chat_rooms__room_id__patch`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |


**Request Body:**

- `application/json` -> `#/components/schemas/RoomUpdate`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/chat/rooms/{room_id}/members

**Summary:** List Members

**Tags:** chat

**operationId:** `list_members_api_v1_chat_rooms__room_id__members_get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/chat/rooms/{room_id}/members

**Summary:** Add Member

**Tags:** chat

**operationId:** `add_member_api_v1_chat_rooms__room_id__members_post`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |


**Request Body:**

- `application/json` -> `#/components/schemas/AddMemberRequest`


**Responses:**

- `201` — Successful Response
- `422` — Validation Error

---

### `DELETE` /api/v1/chat/rooms/{room_id}/members/{target_id}

**Summary:** Remove Member

**Tags:** chat

**operationId:** `remove_member_api_v1_chat_rooms__room_id__members__target_id__delete`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |
| target_id | path | True | `{"type": "integer", "title": "Target Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/chat/rooms/{room_id}/messages

**Summary:** List Messages

**Tags:** chat

**operationId:** `list_messages_api_v1_chat_rooms__room_id__messages_get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 100, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/chat/rooms/{room_id}/messages

**Summary:** Send Message

**Tags:** chat

**operationId:** `send_message_api_v1_chat_rooms__room_id__messages_post`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |


**Request Body:**

- `application/json` -> `#/components/schemas/MessageCreate`


**Responses:**

- `201` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/chat/rooms/{room_id}/read

**Summary:** Mark Read

**Tags:** chat

**operationId:** `mark_read_api_v1_chat_rooms__room_id__read_post`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |


**Request Body:**

- `application/json` -> `#/components/schemas/ReadRequest`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/chat/rooms/{room_id}/read-receipts

**Summary:** List Read Receipts

**Tags:** chat

**operationId:** `list_read_receipts_api_v1_chat_rooms__room_id__read_receipts_get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/chat/rooms/{room_id}/typing

**Summary:** Typing

**Tags:** chat

**operationId:** `typing_api_v1_chat_rooms__room_id__typing_post`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/chat/rooms/{room_id}/unread-count

**Summary:** Unread Count

**Tags:** chat

**operationId:** `unread_count_api_v1_chat_rooms__room_id__unread_count_get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `DELETE` /api/v1/comments/{comment_id}

**Summary:** Delete Comment

**Tags:** comments

**operationId:** `delete_comment_api_v1_comments__comment_id__delete`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| comment_id | path | True | `{"type": "integer", "title": "Comment Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error

---

### `PATCH` /api/v1/comments/{comment_id}

**Summary:** Update Comment

**Tags:** comments

**operationId:** `update_comment_api_v1_comments__comment_id__patch`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| comment_id | path | True | `{"type": "integer", "title": "Comment Id"}` |


**Request Body:**

- `application/json` -> `#/components/schemas/CommentUpdate`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/feed/explore

**Summary:** Explore Feed

**Tags:** feed

**operationId:** `explore_feed_api_v1_feed_explore_get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 50, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/feed/home

**Summary:** Home Feed

**Tags:** feed

**operationId:** `home_feed_api_v1_feed_home_get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 50, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `DELETE` /api/v1/follows/{user_id}

**Summary:** Unfollow a user (idempotent)

**Tags:** follows

**operationId:** `unfollow_api_v1_follows__user_id__delete`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/follows/{user_id}

**Summary:** Follow a user (idempotent)

**Tags:** follows

**operationId:** `follow_api_v1_follows__user_id__post`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/gdpr/cancel-delete

**Summary:** Cancel Deletion

**Tags:** gdpr

**operationId:** `cancel_deletion_api_v1_gdpr_cancel_delete_post`

**Auth:** [{"HTTPBearer": []}]


**Responses:**

- `200` — Successful Response

---

### `GET` /api/v1/gdpr/deletion-status

**Summary:** Deletion Status

**Tags:** gdpr

**operationId:** `deletion_status_api_v1_gdpr_deletion_status_get`

**Auth:** [{"HTTPBearer": []}]


**Responses:**

- `200` — Successful Response

---

### `GET` /api/v1/gdpr/export

**Summary:** Export Data

**Tags:** gdpr

**operationId:** `export_data_api_v1_gdpr_export_get`

**Auth:** [{"HTTPBearer": []}]


**Responses:**

- `200` — Full user data export. Served as a JSON download (Content-Disposition: attachment).

---

### `DELETE` /api/v1/likes/{target_type}/{target_id}

**Summary:** Unlike

**Tags:** likes

**operationId:** `unlike_api_v1_likes__target_type___target_id__delete`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| target_type | path | True | `{"type": "string", "title": "Target Type"}` |
| target_id | path | True | `{"type": "integer", "title": "Target Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/likes/{target_type}/{target_id}

**Summary:** Like

**Tags:** likes

**operationId:** `like_api_v1_likes__target_type___target_id__post`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| target_type | path | True | `{"type": "string", "title": "Target Type"}` |
| target_id | path | True | `{"type": "integer", "title": "Target Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/likes/{target_type}/{target_id}/users

**Summary:** List Likers

**Tags:** likes

**operationId:** `list_likers_api_v1_likes__target_type___target_id__users_get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| target_type | path | True | `{"type": "string", "title": "Target Type"}` |
| target_id | path | True | `{"type": "integer", "title": "Target Id"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 100, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/media

**Summary:** Upload Media

**Tags:** media

**operationId:** `upload_media_api_v1_media_post`

**Auth:** [{"HTTPBearer": []}]


**Request Body:**

- `multipart/form-data` -> `#/components/schemas/Body_upload_media_api_v1_media_post`


**Responses:**

- `201` — Successful Response
- `422` — Validation Error

---

### `DELETE` /api/v1/media/{media_id}

**Summary:** Delete Media

**Tags:** media

**operationId:** `delete_media_api_v1_media__media_id__delete`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| media_id | path | True | `{"type": "integer", "title": "Media Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/media/{media_id}

**Summary:** Get Media

**Tags:** media

**operationId:** `get_media_api_v1_media__media_id__get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| media_id | path | True | `{"type": "integer", "title": "Media Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/media/{media_id}/attach/{post_id}

**Summary:** Attach To Post

**Tags:** media

**operationId:** `attach_to_post_api_v1_media__media_id__attach__post_id__post`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| media_id | path | True | `{"type": "integer", "title": "Media Id"}` |
| post_id | path | True | `{"type": "integer", "title": "Post Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/moderation/reports

**Summary:** List Reports

**Tags:** moderation

**operationId:** `list_reports_api_v1_moderation_reports_get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| status | query | False | `{"anyOf": [{"$ref": "#/components/schemas/ReportStatus"}, {"type": "null"}], "title": "Status"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 100, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/moderation/reports

**Summary:** Create Report

**Tags:** moderation

**operationId:** `create_report_api_v1_moderation_reports_post`

**Auth:** [{"HTTPBearer": []}]


**Request Body:**

- `application/json` -> `#/components/schemas/ReportCreate`


**Responses:**

- `201` — Successful Response
- `422` — Validation Error

---

### `PATCH` /api/v1/moderation/reports/{report_id}

**Summary:** Update Report

**Tags:** moderation

**operationId:** `update_report_api_v1_moderation_reports__report_id__patch`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| report_id | path | True | `{"type": "integer", "title": "Report Id"}` |


**Request Body:**

- `application/json` -> `#/components/schemas/ReportUpdate`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `DELETE` /api/v1/mutes/{user_id}

**Summary:** Unmute

**Tags:** follows

**operationId:** `unmute_api_v1_mutes__user_id__delete`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/mutes/{user_id}

**Summary:** Mute

**Tags:** follows

**operationId:** `mute_api_v1_mutes__user_id__post`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/notifications

**Summary:** List Notifications

**Tags:** notifications

**operationId:** `list_notifications_api_v1_notifications_get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| unread_only | query | False | `{"type": "boolean", "default": false, "title": "Unread Only"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 50, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/notifications/read-all

**Summary:** Mark All Read

**Tags:** notifications

**operationId:** `mark_all_read_api_v1_notifications_read_all_post`

**Auth:** [{"HTTPBearer": []}]


**Responses:**

- `200` — Successful Response

---

### `GET` /api/v1/notifications/unread-count

**Summary:** Unread Count

**Tags:** notifications

**operationId:** `unread_count_api_v1_notifications_unread_count_get`

**Auth:** [{"HTTPBearer": []}]


**Responses:**

- `200` — Successful Response

---

### `DELETE` /api/v1/notifications/{notif_id}

**Summary:** Delete Notification

**Tags:** notifications

**operationId:** `delete_notification_api_v1_notifications__notif_id__delete`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| notif_id | path | True | `{"type": "integer", "title": "Notif Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/notifications/{notif_id}/read

**Summary:** Mark Read

**Tags:** notifications

**operationId:** `mark_read_api_v1_notifications__notif_id__read_post`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| notif_id | path | True | `{"type": "integer", "title": "Notif Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/posts

**Summary:** Create Post

**Tags:** posts

**operationId:** `create_post_api_v1_posts_post`

**Auth:** [{"HTTPBearer": []}]


**Request Body:**

- `application/json` -> `#/components/schemas/PostCreate`


**Responses:**

- `201` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/posts/by-author/{author_id}

**Summary:** List By Author

**Tags:** posts

**operationId:** `list_by_author_api_v1_posts_by_author__author_id__get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| author_id | path | True | `{"type": "integer", "title": "Author Id"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 100, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `DELETE` /api/v1/posts/{post_id}

**Summary:** Delete Post

**Tags:** posts

**operationId:** `delete_post_api_v1_posts__post_id__delete`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| post_id | path | True | `{"type": "integer", "title": "Post Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/posts/{post_id}

**Summary:** Get Post

**Tags:** posts

**operationId:** `get_post_api_v1_posts__post_id__get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| post_id | path | True | `{"type": "integer", "title": "Post Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `PATCH` /api/v1/posts/{post_id}

**Summary:** Update Post

**Tags:** posts

**operationId:** `update_post_api_v1_posts__post_id__patch`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| post_id | path | True | `{"type": "integer", "title": "Post Id"}` |


**Request Body:**

- `application/json` -> `#/components/schemas/PostUpdate`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/posts/{post_id}/comments

**Summary:** List Comments

**Tags:** comments

**operationId:** `list_comments_api_v1_posts__post_id__comments_get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| post_id | path | True | `{"type": "integer", "title": "Post Id"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 100, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `POST` /api/v1/posts/{post_id}/comments

**Summary:** Create Comment

**Tags:** comments

**operationId:** `create_comment_api_v1_posts__post_id__comments_post`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| post_id | path | True | `{"type": "integer", "title": "Post Id"}` |


**Request Body:**

- `application/json` -> `#/components/schemas/CommentCreate`


**Responses:**

- `201` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/presence/{user_id}

**Summary:** Get Presence

**Tags:** presence

**operationId:** `get_presence_api_v1_presence__user_id__get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `DELETE` /api/v1/users/me

**Summary:** Delete Me

**Tags:** users

**operationId:** `delete_me_api_v1_users_me_delete`

**Auth:** [{"HTTPBearer": []}]


**Responses:**

- `200` — Successful Response

---

### `GET` /api/v1/users/me

**Summary:** Get Me

**Tags:** users

**operationId:** `get_me_api_v1_users_me_get`

**Auth:** [{"HTTPBearer": []}]


**Responses:**

- `200` — Successful Response

---

### `PATCH` /api/v1/users/me

**Summary:** Update Me

**Tags:** users

**operationId:** `update_me_api_v1_users_me_patch`

**Auth:** [{"HTTPBearer": []}]


**Request Body:**

- `application/json` -> `#/components/schemas/ProfileUpdate`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/users/me/consent

**Summary:** List Consents

**Tags:** users

**operationId:** `list_consents_api_v1_users_me_consent_get`

**Auth:** [{"HTTPBearer": []}]


**Responses:**

- `200` — Successful Response

---

### `POST` /api/v1/users/me/consent

**Summary:** Grant Consent

**Tags:** users

**operationId:** `grant_consent_api_v1_users_me_consent_post`

**Auth:** [{"HTTPBearer": []}]


**Request Body:**

- `application/json` -> `#/components/schemas/ConsentGrantRequest`


**Responses:**

- `201` — Successful Response
- `422` — Validation Error

---

### `DELETE` /api/v1/users/me/consent/{channel}

**Summary:** Revoke Consent

**Tags:** users

**operationId:** `revoke_consent_api_v1_users_me_consent__channel__delete`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| channel | path | True | `{"type": "string", "title": "Channel"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/users/{user_id}

**Summary:** Get Profile

**Tags:** users

**operationId:** `get_profile_api_v1_users__user_id__get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/users/{user_id}/follow-counts

**Summary:** Counts

**Tags:** follows

**operationId:** `counts_api_v1_users__user_id__follow_counts_get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/users/{user_id}/follow-status

**Summary:** Status Endpoint

**Tags:** follows

**operationId:** `status_endpoint_api_v1_users__user_id__follow_status_get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/users/{user_id}/followers

**Summary:** Followers

**Tags:** follows

**operationId:** `followers_api_v1_users__user_id__followers_get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 100, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `GET` /api/v1/users/{user_id}/following

**Summary:** Following

**Tags:** follows

**operationId:** `following_api_v1_users__user_id__following_get`

**Auth:** [{"HTTPBearer": []}]


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 100, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error

---

### `GET` /health

**Summary:** Liveness probe

**Tags:** health

**operationId:** `liveness`


**Responses:**

- `200` — Successful Response

---

### `GET` /health/circuit-breakers

**Summary:** Circuit-breaker snapshot (admin-only)

**Tags:** health

**operationId:** `health_circuit_breakers`

**Auth:** [{"HTTPBearer": []}]


**Responses:**

- `200` — Successful Response

---

### `GET` /health/db

**Summary:** Database readiness probe

**Tags:** health

**operationId:** `health_db`


**Responses:**

- `200` — Successful Response

---

### `GET` /health/ready

**Summary:** Readiness probe (aggregate)

**Tags:** health

**operationId:** `readiness`


**Responses:**

- `200` — Successful Response

---

### `GET` /health/redis

**Summary:** Redis readiness probe

**Tags:** health

**operationId:** `health_redis`


**Responses:**

- `200` — Successful Response

---
