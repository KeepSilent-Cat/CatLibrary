import { invoke } from "@tauri-apps/api/core";

export type MobileAccessInfo = {
  url: string;
  token: string;
  port: number;
};

/** 查询手机访问服务是否在运行 */
export function mobileAccessStatus() {
  return invoke<MobileAccessInfo | null>("mobile_access_status");
}

/** 启动内网只读服务（只监听内网地址） */
export function startMobileAccess(resourceRoot: string) {
  return invoke<MobileAccessInfo>("start_mobile_access", { resourceRoot });
}

/** 停止服务，token 立即失效 */
export function stopMobileAccess() {
  return invoke<void>("stop_mobile_access");
}
