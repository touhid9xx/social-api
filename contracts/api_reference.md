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
