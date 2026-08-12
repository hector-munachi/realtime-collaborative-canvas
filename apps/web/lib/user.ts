import { colorFromString, createId } from "@icanvas/shared";

export type LocalUser = {
  id: string;
  name: string;
  color: string;
};

const STORAGE_KEY = "icanvas:user";

export function getLocalUser(): LocalUser {
  if (typeof window === "undefined") {
    return {
      id: "server",
      name: "Guest",
      color: "#2563eb"
    };
  }

  const saved = window.localStorage.getItem(STORAGE_KEY);

  if (saved) {
    try {
      return JSON.parse(saved) as LocalUser;
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }

  const id = createId("user");
  const user = {
    id,
    name: `Maker ${id.slice(-4).toUpperCase()}`,
    color: colorFromString(id)
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  return user;
}
