import { Suspense } from "react";
import { ProjectDetail } from "@/components/projects/project-detail";
import { Skeleton } from "@/components/ui/empty";

export default function ProjectDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-4 h-24 w-full rounded-2xl" />
        </div>
      }
    >
      <ProjectDetail />
    </Suspense>
  );
}
