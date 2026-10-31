# Social API — API Reference

**Version:** `0.1.0`

**Generated from commit:** `b3fca9b6f387`

---


## audit

### `GET` /api/v1/audit

**Summary:** List All Audit

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| actor_id | query | False | `{"anyOf": [{"type": "integer"}, {"type": "null"}], "title": "Actor Id"}` |
| action | query | False | `{"anyOf": [{"enum": ["REGISTER", "LOGIN", "LOGOUT", "VERIFY_EMAIL", "PASSWORD_RESET_REQUESTED", "PASSWORD_RESET_COMPLETED", "PROFILE_UPDATE", "CONSENT_GRANTED", "CONSENT_REVOKED", "USER_SOFT_DELETE", "DELETE_POST", "DELETE_COMMENT", "BLOCK", "UNBLOCK", "MUTE", "UNMUTE", "CREATE_CHAT_GROUP", "UPDATE_CHAT_GROUP_TITLE", "ADD_CHAT_MEMBER", "REMOVE_CHAT_MEMBER", "DELETE_CHAT_MESSAGE", "MODERATION_STATUS_UPDATE", "GDPR_DELETE_SCHEDULED", "GDPR_DELETE_CANCELLED", "FEATURE_FLAG_OVERRIDE", "USER_HARD_DELETED", "RETENTION_NOTIFICATIONS_PURGED", "RETENTION_AUDIT_PURGED", "RETENTION_ORPHAN_MEDIA_PURGED", "RETENTION_MESSAGES_PURGED"], "type": "string"}, {"type": "null"}], "title": "Action"}` |
| entity | query | False | `{"anyOf": [{"enum": ["user", "profile", "post", "comment", "message", "chat_room", "report", "notification", "audit_log", "media"], "type": "string"}, {"type": "null"}], "title": "Entity"}` |
| entity_id | query | False | `{"anyOf": [{"type": "integer"}, {"type": "null"}], "title": "Entity Id"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 100, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/audit
```

---

### `GET` /api/v1/audit/me

**Summary:** My Audit

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| action | query | False | `{"anyOf": [{"enum": ["REGISTER", "LOGIN", "LOGOUT", "VERIFY_EMAIL", "PASSWORD_RESET_REQUESTED", "PASSWORD_RESET_COMPLETED", "PROFILE_UPDATE", "CONSENT_GRANTED", "CONSENT_REVOKED", "USER_SOFT_DELETE", "DELETE_POST", "DELETE_COMMENT", "BLOCK", "UNBLOCK", "MUTE", "UNMUTE", "CREATE_CHAT_GROUP", "UPDATE_CHAT_GROUP_TITLE", "ADD_CHAT_MEMBER", "REMOVE_CHAT_MEMBER", "DELETE_CHAT_MESSAGE", "MODERATION_STATUS_UPDATE", "GDPR_DELETE_SCHEDULED", "GDPR_DELETE_CANCELLED", "FEATURE_FLAG_OVERRIDE", "USER_HARD_DELETED", "RETENTION_NOTIFICATIONS_PURGED", "RETENTION_AUDIT_PURGED", "RETENTION_ORPHAN_MEDIA_PURGED", "RETENTION_MESSAGES_PURGED"], "type": "string"}, {"type": "null"}], "title": "Action"}` |
| entity | query | False | `{"anyOf": [{"enum": ["user", "profile", "post", "comment", "message", "chat_room", "report", "notification", "audit_log", "media"], "type": "string"}, {"type": "null"}], "title": "Entity"}` |
| entity_id | query | False | `{"anyOf": [{"type": "integer"}, {"type": "null"}], "title": "Entity Id"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 100, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/audit/me
```

---


## auth

### `POST` /api/v1/auth/forgot-password

**Summary:** Forgot Password

**Auth:** public

**Rate limit:** —

**Errors:** 422


**Request body:**

- `application/json` -> `ForgotPasswordRequest`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -d '{"<see schema>": "ForgotPasswordRequest"}' \
     http://localhost:8000/api/v1/auth/forgot-password
```

---

### `POST` /api/v1/auth/login

**Summary:** Login

**Auth:** public

**Rate limit:** —

**Errors:** 422


**Request body:**

- `application/json` -> `LoginRequest`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -d '{"<see schema>": "LoginRequest"}' \
     http://localhost:8000/api/v1/auth/login
```

---

### `POST` /api/v1/auth/logout

**Summary:** Logout

**Auth:** authenticated

**Rate limit:** —

**Errors:** —


**Responses:**

- `204` — Successful Response


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/auth/logout
```

---

### `GET` /api/v1/auth/me

**Summary:** Me

**Auth:** authenticated

**Rate limit:** —

**Errors:** —


**Responses:**

- `200` — Successful Response


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/auth/me
```

---

### `POST` /api/v1/auth/refresh

**Summary:** Refresh

**Auth:** public

**Rate limit:** —

**Errors:** 422


**Request body:**

- `application/json` -> `RefreshRequest`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -d '{"<see schema>": "RefreshRequest"}' \
     http://localhost:8000/api/v1/auth/refresh
```

---

### `POST` /api/v1/auth/register

**Summary:** Register

**Auth:** public

**Rate limit:** —

**Errors:** 422


**Request body:**

- `application/json` -> `RegisterRequest`


**Responses:**

- `201` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -d '{"<see schema>": "RegisterRequest"}' \
     http://localhost:8000/api/v1/auth/register
```

---

### `POST` /api/v1/auth/reset-password

**Summary:** Reset Password

**Auth:** public

**Rate limit:** —

**Errors:** 422


**Request body:**

- `application/json` -> `ResetPasswordRequest`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -d '{"<see schema>": "ResetPasswordRequest"}' \
     http://localhost:8000/api/v1/auth/reset-password
```

---

### `POST` /api/v1/auth/verify-email

**Summary:** Verify Email

**Auth:** public

**Rate limit:** —

**Errors:** 422


**Request body:**

- `application/json` -> `VerifyEmailRequest`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -d '{"<see schema>": "VerifyEmailRequest"}' \
     http://localhost:8000/api/v1/auth/verify-email
```

---


## chat

### `DELETE` /api/v1/chat/messages/{message_id}

**Summary:** Delete Message

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| message_id | path | True | `{"type": "integer", "title": "Message Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X DELETE -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/chat/messages/{message_id}
```

---

### `GET` /api/v1/chat/rooms

**Summary:** List My Rooms

**Auth:** authenticated

**Rate limit:** —

**Errors:** —


**Responses:**

- `200` — Successful Response


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/chat/rooms
```

---

### `POST` /api/v1/chat/rooms/direct

**Summary:** Create Direct Room

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Request body:**

- `application/json` -> `DirectRoomCreate`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"<see schema>": "DirectRoomCreate"}' \
     http://localhost:8000/api/v1/chat/rooms/direct
```

---

### `POST` /api/v1/chat/rooms/group

**Summary:** Create Group

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Request body:**

- `application/json` -> `GroupRoomCreate`


**Responses:**

- `201` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"<see schema>": "GroupRoomCreate"}' \
     http://localhost:8000/api/v1/chat/rooms/group
```

---

### `GET` /api/v1/chat/rooms/{room_id}

**Summary:** Get Room

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/chat/rooms/{room_id}
```

---

### `PATCH` /api/v1/chat/rooms/{room_id}

**Summary:** Update Room

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |


**Request body:**

- `application/json` -> `RoomUpdate`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X PATCH -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"<see schema>": "RoomUpdate"}' \
     http://localhost:8000/api/v1/chat/rooms/{room_id}
```

---

### `GET` /api/v1/chat/rooms/{room_id}/members

**Summary:** List Members

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/chat/rooms/{room_id}/members
```

---

### `POST` /api/v1/chat/rooms/{room_id}/members

**Summary:** Add Member

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |


**Request body:**

- `application/json` -> `AddMemberRequest`


**Responses:**

- `201` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"<see schema>": "AddMemberRequest"}' \
     http://localhost:8000/api/v1/chat/rooms/{room_id}/members
```

---

### `DELETE` /api/v1/chat/rooms/{room_id}/members/{target_id}

**Summary:** Remove Member

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |
| target_id | path | True | `{"type": "integer", "title": "Target Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X DELETE -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/chat/rooms/{room_id}/members/{target_id}
```

---

### `POST` /api/v1/chat/rooms/{room_id}/messages

**Summary:** Send Message

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |


**Request body:**

- `application/json` -> `MessageCreate`


**Responses:**

- `201` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"<see schema>": "MessageCreate"}' \
     http://localhost:8000/api/v1/chat/rooms/{room_id}/messages
```

---

### `GET` /api/v1/chat/rooms/{room_id}/messages

**Summary:** List Messages

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 100, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/chat/rooms/{room_id}/messages
```

---

### `POST` /api/v1/chat/rooms/{room_id}/read

**Summary:** Mark Read

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |


**Request body:**

- `application/json` -> `ReadRequest`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"<see schema>": "ReadRequest"}' \
     http://localhost:8000/api/v1/chat/rooms/{room_id}/read
```

---

### `GET` /api/v1/chat/rooms/{room_id}/read-receipts

**Summary:** List Read Receipts

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/chat/rooms/{room_id}/read-receipts
```

---

### `POST` /api/v1/chat/rooms/{room_id}/typing

**Summary:** Typing

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/chat/rooms/{room_id}/typing
```

---

### `GET` /api/v1/chat/rooms/{room_id}/unread-count

**Summary:** Unread Count

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| room_id | path | True | `{"type": "integer", "title": "Room Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/chat/rooms/{room_id}/unread-count
```

---


## comments

### `PATCH` /api/v1/comments/{comment_id}

**Summary:** Update Comment

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| comment_id | path | True | `{"type": "integer", "title": "Comment Id"}` |


**Request body:**

- `application/json` -> `CommentUpdate`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X PATCH -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"<see schema>": "CommentUpdate"}' \
     http://localhost:8000/api/v1/comments/{comment_id}
```

---

### `DELETE` /api/v1/comments/{comment_id}

**Summary:** Delete Comment

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| comment_id | path | True | `{"type": "integer", "title": "Comment Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X DELETE -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/comments/{comment_id}
```

---

### `POST` /api/v1/posts/{post_id}/comments

**Summary:** Create Comment

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| post_id | path | True | `{"type": "integer", "title": "Post Id"}` |


**Request body:**

- `application/json` -> `CommentCreate`


**Responses:**

- `201` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"<see schema>": "CommentCreate"}' \
     http://localhost:8000/api/v1/posts/{post_id}/comments
```

---

### `GET` /api/v1/posts/{post_id}/comments

**Summary:** List Comments

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| post_id | path | True | `{"type": "integer", "title": "Post Id"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 100, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/posts/{post_id}/comments
```

---


## feed

### `GET` /api/v1/feed/explore

**Summary:** Explore Feed

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 50, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/feed/explore
```

---

### `GET` /api/v1/feed/home

**Summary:** Home Feed

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 50, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/feed/home
```

---


## flags

### `GET` /api/v1/flags

**Summary:** List Flags

**Auth:** authenticated

**Rate limit:** —

**Errors:** —


**Responses:**

- `200` — Successful Response


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/flags
```

---

### `POST` /api/v1/flags/{flag_name}/override

**Summary:** Override Flag

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| flag_name | path | True | `{"type": "string", "title": "Flag Name"}` |


**Request body:**

- `application/json` -> `FlagOverride`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"<see schema>": "FlagOverride"}' \
     http://localhost:8000/api/v1/flags/{flag_name}/override
```

---


## follows

### `POST` /api/v1/blocks/{user_id}

**Summary:** Block

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/blocks/{user_id}
```

---

### `DELETE` /api/v1/blocks/{user_id}

**Summary:** Unblock

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X DELETE -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/blocks/{user_id}
```

---

### `POST` /api/v1/follows/{user_id}

**Summary:** Follow a user (idempotent)

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/follows/{user_id}
```

---

### `DELETE` /api/v1/follows/{user_id}

**Summary:** Unfollow a user (idempotent)

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X DELETE -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/follows/{user_id}
```

---

### `POST` /api/v1/mutes/{user_id}

**Summary:** Mute

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/mutes/{user_id}
```

---

### `DELETE` /api/v1/mutes/{user_id}

**Summary:** Unmute

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X DELETE -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/mutes/{user_id}
```

---

### `GET` /api/v1/users/{user_id}/follow-counts

**Summary:** Counts

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/users/{user_id}/follow-counts
```

---

### `GET` /api/v1/users/{user_id}/follow-status

**Summary:** Status Endpoint

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/users/{user_id}/follow-status
```

---

### `GET` /api/v1/users/{user_id}/followers

**Summary:** Followers

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 100, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/users/{user_id}/followers
```

---

### `GET` /api/v1/users/{user_id}/following

**Summary:** Following

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 100, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/users/{user_id}/following
```

---


## gdpr

### `POST` /api/v1/gdpr/cancel-delete

**Summary:** Cancel Deletion

**Auth:** authenticated

**Rate limit:** —

**Errors:** —


**Responses:**

- `200` — Successful Response


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/gdpr/cancel-delete
```

---

### `GET` /api/v1/gdpr/deletion-status

**Summary:** Deletion Status

**Auth:** authenticated

**Rate limit:** —

**Errors:** —


**Responses:**

- `200` — Successful Response


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/gdpr/deletion-status
```

---

### `GET` /api/v1/gdpr/export

**Summary:** Export Data

**Auth:** authenticated

**Rate limit:** —

**Errors:** —


**Responses:**

- `200` — Full user data export. Served as a JSON download (Content-Disposition: attachment).


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/gdpr/export
```

---


## health

### `GET` /health

**Summary:** Liveness probe

**Auth:** public

**Rate limit:** —

**Errors:** —


**Responses:**

- `200` — Successful Response


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" \
     http://localhost:8000/health
```

---

### `GET` /health/circuit-breakers

**Summary:** Circuit-breaker snapshot (admin-only)

**Auth:** authenticated

**Rate limit:** —

**Errors:** —


**Responses:**

- `200` — Successful Response


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/health/circuit-breakers
```

---

### `GET` /health/db

**Summary:** Database readiness probe

**Auth:** public

**Rate limit:** —

**Errors:** —


**Responses:**

- `200` — Successful Response


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" \
     http://localhost:8000/health/db
```

---

### `GET` /health/ready

**Summary:** Readiness probe (aggregate)

**Auth:** public

**Rate limit:** —

**Errors:** —


**Responses:**

- `200` — Successful Response


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" \
     http://localhost:8000/health/ready
```

---

### `GET` /health/redis

**Summary:** Redis readiness probe

**Auth:** public

**Rate limit:** —

**Errors:** —


**Responses:**

- `200` — Successful Response


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" \
     http://localhost:8000/health/redis
```

---


## likes

### `POST` /api/v1/likes/{target_type}/{target_id}

**Summary:** Like

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| target_type | path | True | `{"type": "string", "title": "Target Type"}` |
| target_id | path | True | `{"type": "integer", "title": "Target Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/likes/{target_type}/{target_id}
```

---

### `DELETE` /api/v1/likes/{target_type}/{target_id}

**Summary:** Unlike

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| target_type | path | True | `{"type": "string", "title": "Target Type"}` |
| target_id | path | True | `{"type": "integer", "title": "Target Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X DELETE -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/likes/{target_type}/{target_id}
```

---

### `GET` /api/v1/likes/{target_type}/{target_id}/users

**Summary:** List Likers

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


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


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/likes/{target_type}/{target_id}/users
```

---


## media

### `POST` /api/v1/media

**Summary:** Upload Media

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Request body:**

- `multipart/form-data` -> `Body_upload_media_api_v1_media_post`


**Responses:**

- `201` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/media
```

---

### `GET` /api/v1/media/{media_id}

**Summary:** Get Media

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| media_id | path | True | `{"type": "integer", "title": "Media Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/media/{media_id}
```

---

### `DELETE` /api/v1/media/{media_id}

**Summary:** Delete Media

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| media_id | path | True | `{"type": "integer", "title": "Media Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X DELETE -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/media/{media_id}
```

---

### `POST` /api/v1/media/{media_id}/attach/{post_id}

**Summary:** Attach To Post

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| media_id | path | True | `{"type": "integer", "title": "Media Id"}` |
| post_id | path | True | `{"type": "integer", "title": "Post Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/media/{media_id}/attach/{post_id}
```

---


## moderation

### `POST` /api/v1/moderation/reports

**Summary:** Create Report

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Request body:**

- `application/json` -> `ReportCreate`


**Responses:**

- `201` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"<see schema>": "ReportCreate"}' \
     http://localhost:8000/api/v1/moderation/reports
```

---

### `GET` /api/v1/moderation/reports

**Summary:** List Reports

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| status | query | False | `{"anyOf": [{"$ref": "#/components/schemas/ReportStatus"}, {"type": "null"}], "title": "Status"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 100, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/moderation/reports
```

---

### `PATCH` /api/v1/moderation/reports/{report_id}

**Summary:** Update Report

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| report_id | path | True | `{"type": "integer", "title": "Report Id"}` |


**Request body:**

- `application/json` -> `ReportUpdate`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X PATCH -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"<see schema>": "ReportUpdate"}' \
     http://localhost:8000/api/v1/moderation/reports/{report_id}
```

---


## notifications

### `GET` /api/v1/notifications

**Summary:** List Notifications

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| unread_only | query | False | `{"type": "boolean", "default": false, "title": "Unread Only"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 50, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/notifications
```

---

### `POST` /api/v1/notifications/read-all

**Summary:** Mark All Read

**Auth:** authenticated

**Rate limit:** —

**Errors:** —


**Responses:**

- `200` — Successful Response


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/notifications/read-all
```

---

### `GET` /api/v1/notifications/unread-count

**Summary:** Unread Count

**Auth:** authenticated

**Rate limit:** —

**Errors:** —


**Responses:**

- `200` — Successful Response


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/notifications/unread-count
```

---

### `DELETE` /api/v1/notifications/{notif_id}

**Summary:** Delete Notification

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| notif_id | path | True | `{"type": "integer", "title": "Notif Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X DELETE -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/notifications/{notif_id}
```

---

### `POST` /api/v1/notifications/{notif_id}/read

**Summary:** Mark Read

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| notif_id | path | True | `{"type": "integer", "title": "Notif Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/notifications/{notif_id}/read
```

---


## posts

### `POST` /api/v1/posts

**Summary:** Create Post

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Request body:**

- `application/json` -> `PostCreate`


**Responses:**

- `201` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"<see schema>": "PostCreate"}' \
     http://localhost:8000/api/v1/posts
```

---

### `GET` /api/v1/posts/by-author/{author_id}

**Summary:** List By Author

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| author_id | path | True | `{"type": "integer", "title": "Author Id"}` |
| cursor | query | False | `{"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Cursor"}` |
| limit | query | False | `{"anyOf": [{"type": "integer", "maximum": 100, "minimum": 1}, {"type": "null"}], "title": "Limit"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/posts/by-author/{author_id}
```

---

### `GET` /api/v1/posts/{post_id}

**Summary:** Get Post

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| post_id | path | True | `{"type": "integer", "title": "Post Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/posts/{post_id}
```

---

### `PATCH` /api/v1/posts/{post_id}

**Summary:** Update Post

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| post_id | path | True | `{"type": "integer", "title": "Post Id"}` |


**Request body:**

- `application/json` -> `PostUpdate`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X PATCH -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"<see schema>": "PostUpdate"}' \
     http://localhost:8000/api/v1/posts/{post_id}
```

---

### `DELETE` /api/v1/posts/{post_id}

**Summary:** Delete Post

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| post_id | path | True | `{"type": "integer", "title": "Post Id"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X DELETE -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/posts/{post_id}
```

---


## presence

### `GET` /api/v1/presence/{user_id}

**Summary:** Get Presence

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/presence/{user_id}
```

---


## users

### `GET` /api/v1/users/me

**Summary:** Get Me

**Auth:** authenticated

**Rate limit:** —

**Errors:** —


**Responses:**

- `200` — Successful Response


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/users/me
```

---

### `DELETE` /api/v1/users/me

**Summary:** Delete Me

**Auth:** authenticated

**Rate limit:** —

**Errors:** —


**Responses:**

- `200` — Successful Response


**Example:**

```bash
curl -X DELETE -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/users/me
```

---

### `PATCH` /api/v1/users/me

**Summary:** Update Me

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Request body:**

- `application/json` -> `ProfileUpdate`


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X PATCH -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"<see schema>": "ProfileUpdate"}' \
     http://localhost:8000/api/v1/users/me
```

---

### `GET` /api/v1/users/me/consent

**Summary:** List Consents

**Auth:** authenticated

**Rate limit:** —

**Errors:** —


**Responses:**

- `200` — Successful Response


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/users/me/consent
```

---

### `POST` /api/v1/users/me/consent

**Summary:** Grant Consent

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Request body:**

- `application/json` -> `ConsentGrantRequest`


**Responses:**

- `201` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"<see schema>": "ConsentGrantRequest"}' \
     http://localhost:8000/api/v1/users/me/consent
```

---

### `DELETE` /api/v1/users/me/consent/{channel}

**Summary:** Revoke Consent

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| channel | path | True | `{"type": "string", "title": "Channel"}` |


**Responses:**

- `204` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X DELETE -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/users/me/consent/{channel}
```

---

### `GET` /api/v1/users/{user_id}

**Summary:** Get Profile

**Auth:** authenticated

**Rate limit:** —

**Errors:** 422


**Parameters:**

| Name | In | Required | Schema |
|---|---|---|---|
| user_id | path | True | `{"type": "integer", "title": "User Id"}` |


**Responses:**

- `200` — Successful Response
- `422` — Validation Error


**Example:**

```bash
curl -X GET -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/api/v1/users/{user_id}
```

---
