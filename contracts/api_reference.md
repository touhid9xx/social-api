# Social API — API Reference

Version: `0.1.0`

Base URL: `/`

---

## Endpoints

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

**operationId:** `health_health_get`


**Responses:**

- `200` — Successful Response

---

### `GET` /health/db

**Summary:** Database readiness probe

**Tags:** health

**operationId:** `health_db_health_db_get`


**Responses:**

- `200` — Successful Response

---

### `GET` /health/ready

**Summary:** Readiness probe (aggregate)

**Tags:** health

**operationId:** `readiness_health_ready_get`


**Responses:**

- `200` — Successful Response

---

### `GET` /health/redis

**Summary:** Redis readiness probe

**Tags:** health

**operationId:** `health_redis_health_redis_get`


**Responses:**

- `200` — Successful Response

---
