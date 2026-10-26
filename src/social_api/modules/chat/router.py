"""Chat HTTP endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.rate_limit import _key_by_user_or_ip, limiter
from social_api.db.session import get_db
from social_api.deps import CurrentUser, get_current_user
from social_api.modules.chat.schemas import (
    DirectRoomCreate,
    MemberReadState,
    MessageCreate,
    MessagePage,
    MessageView,
    ReadReceiptsList,
    ReadRequest,
    RoomView,
    UnreadCount,
)
from social_api.modules.chat.service import ChatService, _to_room_view

router = APIRouter(prefix="/chat", tags=["chat"])


def _svc(session: AsyncSession) -> ChatService:
    return ChatService(session)


@router.post("/rooms/direct", response_model=RoomView)
async def create_direct_room(
    payload: DirectRoomCreate,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> RoomView:
    return await _svc(session).find_or_create_direct(user_id=user.user.id, payload=payload)


@router.get("/rooms", response_model=list[RoomView])
async def list_my_rooms(
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[RoomView]:
    return await _svc(session).list_my_rooms(user_id=user.user.id)


@router.get("/rooms/{room_id}", response_model=RoomView)
async def get_room(
    room_id: int,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> RoomView:
    room = await _svc(session).get_room_for_member(user_id=user.user.id, room_id=room_id)
    return _to_room_view(room)


@router.post(
    "/rooms/{room_id}/messages",
    response_model=MessageView,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/minute", key_func=_key_by_user_or_ip)
async def send_message(
    request: Request,
    response: Response,  # ← slowapi needs this to inject headers
    room_id: int,
    payload: MessageCreate,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessageView:
    # `request` and `response` are required by slowapi's @limiter.limit
    # when headers_enabled=True (which our Limiter has, for X-RateLimit-*).
    # FastAPI creates the Response object automatically; slowapi injects
    # rate-limit headers into it after our handler returns. The body is
    # still serialized from the return value — Response param is not
    # touched by us directly.
    _ = (request, response)
    return await _svc(session).send_message(
        sender_id=user.user.id, room_id=room_id, payload=payload
    )


@router.get("/rooms/{room_id}/messages", response_model=MessagePage)
async def list_messages(
    room_id: int,
    cursor: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MessagePage:
    return await _svc(session).list_messages(
        user_id=user.user.id,
        room_id=room_id,
        cursor=cursor,
        limit=limit,
    )


@router.delete(
    "/messages/{message_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_message(
    message_id: int,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await _svc(session).delete_message(actor=user.user, message_id=message_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/rooms/{room_id}/read", response_model=MemberReadState)
async def mark_read(
    room_id: int,
    payload: ReadRequest,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MemberReadState:
    return await _svc(session).mark_read(
        user_id=user.user.id, room_id=room_id, message_id=payload.message_id
    )


@router.get(
    "/rooms/{room_id}/read-receipts",
    response_model=ReadReceiptsList,
)
async def list_read_receipts(
    room_id: int,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ReadReceiptsList:
    return await _svc(session).list_read_receipts(user_id=user.user.id, room_id=room_id)


@router.get("/rooms/{room_id}/unread-count", response_model=UnreadCount)
async def unread_count(
    room_id: int,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> UnreadCount:
    return await _svc(session).unread_count(user_id=user.user.id, room_id=room_id)


@router.post(
    "/rooms/{room_id}/typing",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
@limiter.limit("60/minute", key_func=_key_by_user_or_ip)
async def typing(
    request: Request,
    response: Response,  # ← slowapi needs this to inject headers
    room_id: int,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    _ = (request, response)
    await _svc(session).publish_typing(user_id=user.user.id, room_id=room_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
