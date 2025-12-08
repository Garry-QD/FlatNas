import type { BookmarkItem } from "@/types";

export const parseBookmarks = (html: string): BookmarkItem[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const links = doc.querySelectorAll("a");

  const newItems: BookmarkItem[] = [];
  links.forEach((link) => {
    const url = link.href;
    if (!url.startsWith("http")) return; // Skip non-http links (e.g. chrome://)

    let icon = link.getAttribute("icon");
    if (!icon) {
      try {
        icon = `https://api.iowen.cn/favicon/${new URL(url).hostname}.png`;
      } catch {
        icon = "";
      }
    }

    newItems.push({
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      title: link.textContent || url,
      url: url,
      icon: icon || "",
    });
  });

  return newItems;
};
