"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, ShieldAlert, Users } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Skeleton } from "@/components/ui/empty";
import { ROLE_LABEL } from "@/lib/utils";

export default function OrganizationPage() {
  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: api.users.list,
    retry: false,
  });
  const departmentsQuery = useQuery({
    queryKey: ["departments"],
    queryFn: api.users.departments,
  });

  const forbidden =
    usersQuery.error instanceof ApiError && usersQuery.error.status === 403;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1080px] px-5 py-6 lg:px-8">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Organization</p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-slate-900">组织管理</h2>
          <p className="mt-1 text-[12px] text-slate-500">成员、部门与角色。部门用于组织与推荐，不限制跨部门知识访问。</p>
        </div>

        {forbidden ? (
          <EmptyState
            icon={ShieldAlert}
            title="需要主席团或负责人权限"
            description="普通成员可以在项目中协作，但成员名册仅对管理角色开放。"
          />
        ) : (
          <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_300px]">
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
              <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
                <Users size={15} className="text-indigo-500" />
                <p className="text-[13px] font-semibold text-slate-800">成员名册</p>
              </div>
              {usersQuery.isLoading ? (
                <div className="space-y-2 p-4">
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                </div>
              ) : (
                <div>
                  {(usersQuery.data ?? []).map((user) => (
                    <div key={user.id} className="flex items-center gap-3 border-b border-slate-50 px-5 py-3.5 last:border-0">
                      <Avatar name={user.name} size={34} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-slate-800">{user.name}</p>
                        <p className="text-[10px] text-slate-400">
                          {user.email} · {user.title ?? "未设置职务"}
                        </p>
                      </div>
                      <div className="hidden items-center gap-1 sm:flex">
                        {user.departments.map((department) => (
                          <Badge key={department.id} variant="outline">
                            {department.name}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex gap-1">
                        {user.roles.map((role) => (
                          <Badge key={role.id} variant="brand">
                            {ROLE_LABEL[role.code] ?? role.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white p-5">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
                <Building2 size={15} className="text-indigo-500" /> 部门
              </div>
              <div className="mt-3 space-y-2">
                {(departmentsQuery.data ?? []).map((department) => (
                  <div key={department.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
                    <span className="text-[11.5px] text-slate-700">{department.name}</span>
                    <span className="text-[10px] text-slate-400">{department.code}</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[10px] leading-5 text-slate-400">
                一个成员可以关联多个部门。部门归属主要用于组织管理、人员推荐和资料分类。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
