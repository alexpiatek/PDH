export const LOCAL_BROWSER_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);

export type LocalAccessInfo = {
  lanHost: string;
  origin: string;
  playUrl: string;
};
