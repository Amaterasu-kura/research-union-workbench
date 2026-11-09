import { Suspense } from "react";
import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { Skeleton } from "@/components/ui/empty";

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Skeleton className="h-8 w-48" />
        </div>
      }
    >
      <ChatWorkspace />
    </Suspense>
  );
}
