from fastapi import APIRouter

from app.api.routes import (
    agent,
    auth,
    conversations,
    files,
    knowledge,
    notifications,
    projects,
    tasks,
    users,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(projects.router)
api_router.include_router(conversations.router)
api_router.include_router(files.router)
api_router.include_router(knowledge.router)
api_router.include_router(tasks.router)
api_router.include_router(tasks.exchange_router)
api_router.include_router(notifications.router)
api_router.include_router(agent.router)
