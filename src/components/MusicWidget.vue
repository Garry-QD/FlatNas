<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from "vue";
import { useMainStore } from "@/stores/main";
import { useDebounceFn } from "@vueuse/core";
import type { WidgetConfig } from "@/types";

interface LyricLine {
  time: number;
  text: string;
}

const props = defineProps<{ widget: WidgetConfig }>();
const store = useMainStore();

const ICON_PREV = "\u23EE\uFE0E";
const ICON_NEXT = "\u23ED\uFE0E";
const ICON_PLAY = "\u25B6\uFE0E";
const ICON_PAUSE = "\u23F8\uFE0E";
const ICON_MODE_SEQUENCE = "\u{1F501}\uFE0E"; // 🔁
const ICON_MODE_RANDOM = "\u{1F500}\uFE0E"; // 🔀
const ICON_MODE_SINGLE = "\u{1F502}\uFE0E"; // 🔂

// --- Data Types based on API ---
interface Track {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  coverUrl?: string; // Derived or direct
  coverId?: string;
  lyrics?: string;
}

interface PlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  currentTrackId: string | null;
  playbackMode: "sequence" | "random" | "single";
  lyrics?: string;
}

interface Playlist {
  id: string;
  name: string;
  coverUrl?: string;
}

interface Artist {
  id: string;
  name: string;
  coverUrl?: string;
}

interface Album {
  id: string;
  title: string;
  artist?: string;
  coverUrl?: string;
}

// --- State ---
const tracks = ref<Track[]>([]);
const playlists = ref<Playlist[]>([]);
const artists = ref<Artist[]>([]);
const albums = ref<Album[]>([]);

type LibraryMode = "songs" | "playlists" | "artists" | "albums";
const libraryMode = ref<LibraryMode>("songs");

type VisualMode = "lyrics" | "spectrum" | "abstract" | "vinyl";
const visualMode = ref<VisualMode>("lyrics");
const showVisualModeMenu = ref(false);

const visualModeOptions = [
  { id: "lyrics", label: "歌词", icon: "📝" },
  { id: "spectrum", label: "频谱分析", icon: "📊" },
  { id: "abstract", label: "抽象动画", icon: "✨" },
  { id: "vinyl", label: "封面与黑胶", icon: "💿" },
];

const toggleVisualMode = (mode: VisualMode) => {
  visualMode.value = mode;
  showVisualModeMenu.value = false;
};

const currentPlaylistId = ref<string | null>(null);
const currentArtistId = ref<string | null>(null);
const currentAlbumId = ref<string | null>(null);
const playerState = ref<PlayerState>({
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.7,
  currentTrackId: null,
  playbackMode: "sequence",
});

// --- Sync with global player state ---
watch(
  () => store.activeMusicPlayer,
  (val) => {
    if (val !== "music-widget" && playerState.value.isPlaying) {
      if (audioRef.value) audioRef.value.pause();
      playerState.value.isPlaying = false;
    }
  },
);

const audioRef = ref<HTMLAudioElement | null>(null);
const localAudioRef = ref<HTMLAudioElement | null>(null);
const useGlobalAudio = ref(false);
const loading = ref(false);
const error = ref("");

const syncPlayerState = computed(() => props.widget.data?.syncPlayerState === true);
const isMiniSmall = computed(() => props.widget.colSpan === 1 && props.widget.rowSpan === 1);
const isTallMini = computed(() => props.widget.colSpan === 1 && props.widget.rowSpan === 3);
const browseTracks = ref<Track[]>([]);
const miniLoading = ref(false);
const miniError = ref("");
const miniPanelOpen = ref(false);
const miniVolumeOpen = ref(false);
const bufferedTime = ref(0);
const audioObjectUrl = ref<string | null>(null);
const audioObjectUrlTrackId = ref<string | null>(null);

const miniListOpen = computed(() => (isTallMini.value ? true : miniPanelOpen.value));
const currentCoverUrl = computed(() => {
  if (currentTrackDetail.value) {
    return getCoverUrl(currentTrackDetail.value);
  }
  if (libraryMode.value === "artists" && currentArtistId.value) {
    const artist = artists.value.find((a) => a.id === currentArtistId.value);
    return artist?.coverUrl;
  }
  return undefined;
});
const playedPercent = computed(() => {
  const d = playerState.value.duration || 0;
  if (!d) return 0;
  return Math.max(0, Math.min(100, (playerState.value.currentTime / d) * 100));
});
const loadedPercent = computed(() => {
  const d = playerState.value.duration || 0;
  if (!d) return 0;
  return Math.max(0, Math.min(100, (bufferedTime.value / d) * 100));
});

// --- API Methods (Mocking if needed, but designed for the spec) ---
// Base URL - In real scenario, this might be configurable
const API_BASE = computed(() => {
  let url = props.widget.data?.apiUrl || "/api";
  url = url.replace(/\/$/, "");
  if (!/\/api(\/v\d+)?$/.test(url)) url += "/api";
  return url;
});

const getHeaders = () => {
  const headers: Record<string, string> = {};
  if (props.widget.data?.token) {
    headers["Authorization"] = `Bearer ${props.widget.data.token}`;
  }
  return headers;
};

const login = async () => {
  if (!props.widget.data?.username || !props.widget.data?.password) return;
  try {
    const res = await fetch(`${API_BASE.value}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: props.widget.data.username,
        password: props.widget.data.password,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.token) {
        const targetWidget = store.widgets.find((w) => w.id === props.widget.id);
        if (targetWidget && targetWidget.data) {
          targetWidget.data.token = data.token;
          store.saveData();
        }
        // Optionally fetch profile
        fetchProfile();
      }
    }
  } catch (e) {
    console.error("Login failed", e);
  }
};

const fetchProfile = async () => {
  try {
    const res = await fetch(`${API_BASE.value}/auth/me`, {
      headers: getHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      // Store user info if needed
      console.log("User profile:", data);
    }
  } catch (e) {
    console.error("Fetch profile failed", e);
  }
};

const fetchPlayerState = async () => {
  try {
    const res = await fetch(`${API_BASE.value}/player`, {
      headers: getHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      // Assume data matches PlayerState structure or mapping is needed
      // Sync local state
      playerState.value.isPlaying = data.isPlaying;
      if (!isSeeking.value) {
        playerState.value.currentTime = data.progress || data.currentTime || 0;
      }
      playerState.value.volume = data.volume ?? 0.7;
      playerState.value.currentTrackId = data.currentTrack?.id || data.currentTrackId;
      if (data.lyrics || data.currentTrack?.lyrics) {
        playerState.value.lyrics = data.lyrics || data.currentTrack?.lyrics;
      }

      // Sync queue if provided
      if (data.queue && Array.isArray(data.queue)) {
        tracks.value = data.queue.map(normalizeTrack).filter(Boolean) as Track[];
      }

      // If we have a current track but it's not in the tracks list, we might want to fetch it or add it
      const current = normalizeTrack(data.currentTrack);
      if (current && !tracks.value.find((t) => t.id === current.id)) {
        tracks.value.push(current);
      }

      if (audioRef.value) {
        audioRef.value.volume = playerState.value.volume;
      }
    }
  } catch (e) {
    console.error("Fetch player state failed", e);
  }
};

const playAll = async () => {
  if (tracks.value.length === 0) {
    error.value = "列表为空，无法播放";
    return;
  }

  const trackIds = tracks.value.map((t) => t.id);
  loading.value = true;
  error.value = "";

  try {
    // 1. Replace queue
    const res = await fetch(`${API_BASE.value}/player/queue`, {
      method: "PUT",
      headers: { ...getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ trackIds }),
    });

    if (!res.ok) {
      console.warn("Queue replace failed", res.status);
      // fallback?
    }

    // 2. Play first track locally (triggers apiPlay via event if synced)
    if (tracks.value.length > 0 && tracks.value[0]) {
      await playTrack(tracks.value[0]);
    }

    if (syncPlayerState.value) fetchPlayerState();
  } catch (e) {
    console.error("Play all failed", e);
    error.value = "播放全部失败: " + (e instanceof Error ? e.message : String(e));
  } finally {
    loading.value = false;
  }
};
const apiPlay = async (trackId?: string) => {
  try {
    const body: { trackId?: string } = {};
    if (trackId) body.trackId = trackId;

    await fetch(`${API_BASE.value}/player/play`, {
      method: "POST",
      headers: { ...getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error(e);
  }
};

const apiPause = async () => {
  try {
    await fetch(`${API_BASE.value}/player/pause`, {
      method: "POST",
      headers: getHeaders(),
    });
  } catch (e) {
    console.error(e);
  }
};

const apiNext = async () => {
  try {
    await fetch(`${API_BASE.value}/player/next`, {
      method: "POST",
      headers: getHeaders(),
    });
    if (syncPlayerState.value) fetchPlayerState();
  } catch (e) {
    console.error(e);
  }
};

const apiPrev = async () => {
  try {
    await fetch(`${API_BASE.value}/player/prev`, {
      method: "POST",
      headers: getHeaders(),
    });
    if (syncPlayerState.value) fetchPlayerState();
  } catch (e) {
    console.error(e);
  }
};

const apiVolume = async (vol: number) => {
  try {
    await fetch(`${API_BASE.value}/player/volume`, {
      method: "POST",
      headers: { ...getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ volume: vol }),
    });
    // Optimistic update
    playerState.value.volume = vol;
  } catch (e) {
    console.error(e);
  }
};

interface RawItem {
  id: string;
  name?: string;
  title?: string;
  artist?: string;
  coverUrl?: string;
  cover?: string;
  [key: string]: unknown;
}

const normalizeList = (data: unknown) => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.tracks)) return obj.tracks;
    if (Array.isArray(obj.songs)) return obj.songs;
  }
  return [] as unknown[];
};

const normalizeTrack = (t: unknown): Track | null => {
  if (!t || typeof t !== "object") return null;
  const obj = t as Record<string, unknown>;

  const trackObj =
    obj.track && typeof obj.track === "object" ? (obj.track as Record<string, unknown>) : obj;

  const toIdString = (v: unknown): string | null => {
    if (typeof v === "string") return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    return null;
  };

  const id = toIdString(
    trackObj.id ?? obj.trackId ?? trackObj.trackId ?? obj.songId ?? trackObj.songId ?? obj.id,
  );
  const title =
    typeof trackObj.title === "string"
      ? trackObj.title
      : typeof trackObj.name === "string"
        ? trackObj.name
        : typeof trackObj.songName === "string"
          ? (trackObj.songName as string)
          : typeof obj.title === "string"
            ? obj.title
            : typeof obj.name === "string"
              ? obj.name
              : typeof obj.songName === "string"
                ? (obj.songName as string)
                : null;

  if (!id || !title) return null;

  const albumObj =
    trackObj.album && typeof trackObj.album === "object"
      ? (trackObj.album as Record<string, unknown>)
      : null;

  const artist =
    Array.isArray(trackObj.artists) && trackObj.artists.length > 0
      ? trackObj.artists
          .map((a: unknown) => {
            if (typeof a === "string") return a;
            if (a && typeof a === "object") {
              const obj = a as Record<string, unknown>;
              if (typeof obj.name === "string") return obj.name;
            }
            return "";
          })
          .filter(Boolean)
          .join(", ")
      : typeof trackObj.artist === "string"
        ? trackObj.artist
        : trackObj.artist &&
            typeof trackObj.artist === "object" &&
            typeof (trackObj.artist as Record<string, unknown>).name === "string"
          ? ((trackObj.artist as Record<string, unknown>).name as string)
          : typeof trackObj.singer === "string"
            ? (trackObj.singer as string)
            : typeof trackObj.artistName === "string"
              ? (trackObj.artistName as string)
              : typeof obj.artistName === "string"
                ? (obj.artistName as string)
                : typeof obj.singer === "string"
                  ? (obj.singer as string)
                  : undefined;

  const album =
    trackObj.album &&
    typeof trackObj.album === "object" &&
    typeof (trackObj.album as Record<string, unknown>).title === "string"
      ? ((trackObj.album as Record<string, unknown>).title as string)
      : typeof trackObj.album === "string"
        ? trackObj.album
        : typeof trackObj.albumName === "string"
          ? (trackObj.albumName as string)
          : typeof trackObj.albumTitle === "string"
            ? (trackObj.albumTitle as string)
            : typeof obj.albumTitle === "string"
              ? obj.albumTitle
              : typeof obj.albumName === "string"
                ? (obj.albumName as string)
                : undefined;

  const duration =
    typeof trackObj.duration === "number"
      ? trackObj.duration
      : typeof obj.duration === "number"
        ? obj.duration
        : typeof trackObj.length === "number"
          ? trackObj.length
          : typeof obj.length === "number"
            ? obj.length
            : undefined;
  const coverFromObj =
    trackObj.cover && typeof trackObj.cover === "object"
      ? (trackObj.cover as Record<string, unknown>)
      : obj.cover && typeof obj.cover === "object"
        ? (obj.cover as Record<string, unknown>)
        : null;
  const coverUrl =
    typeof trackObj.coverArtUrl === "string"
      ? trackObj.coverArtUrl
      : typeof trackObj.coverUrl === "string"
        ? trackObj.coverUrl
        : albumObj && typeof albumObj.coverArtUrl === "string"
          ? albumObj.coverArtUrl
          : albumObj && typeof albumObj.coverUrl === "string"
            ? albumObj.coverUrl
            : coverFromObj && typeof coverFromObj.url === "string"
              ? (coverFromObj.url as string)
              : coverFromObj && typeof coverFromObj.src === "string"
                ? (coverFromObj.src as string)
                : coverFromObj && typeof coverFromObj.path === "string"
                  ? (coverFromObj.path as string)
                  : coverFromObj && typeof coverFromObj.imageUrl === "string"
                    ? (coverFromObj.imageUrl as string)
                    : typeof trackObj.imageUrl === "string"
                      ? (trackObj.imageUrl as string)
                      : typeof trackObj.coverArtPath === "string"
                        ? trackObj.coverArtPath
                        : albumObj && typeof albumObj.coverArtPath === "string"
                          ? albumObj.coverArtPath
                          : typeof obj.coverArtUrl === "string"
                            ? obj.coverArtUrl
                            : typeof obj.coverUrl === "string"
                              ? obj.coverUrl
                              : typeof obj.imageUrl === "string"
                                ? (obj.imageUrl as string)
                                : undefined;
  const coverId =
    typeof trackObj.coverId === "string"
      ? trackObj.coverId
      : typeof obj.coverId === "string"
        ? obj.coverId
        : undefined;

  const lyrics =
    typeof trackObj.lyrics === "string"
      ? trackObj.lyrics
      : typeof obj.lyrics === "string"
        ? obj.lyrics
        : undefined;

  return { id, title, artist, album, duration, coverUrl, coverId, lyrics };
};

const authedJson = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, { ...init, headers: { ...getHeaders(), ...(init?.headers || {}) } });
  if (res.status !== 401) return res;
  await login();
  return fetch(url, { ...init, headers: { ...getHeaders(), ...(init?.headers || {}) } });
};

const fetchBrowseTracks = async () => {
  miniLoading.value = true;
  miniError.value = "";
  try {
    let res = await authedJson(`${API_BASE.value}/songs?take=1000`);
    if (!res.ok) res = await authedJson(`${API_BASE.value}/tracks?take=1000`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const list = normalizeList(data);
    const next = list.map(normalizeTrack).filter(Boolean) as Track[];
    browseTracks.value = next;
  } catch (e) {
    browseTracks.value = [];
    miniError.value = (e as Error).message || "加载失败";
  } finally {
    miniLoading.value = false;
  }
};

const setQueueAndPlay = (nextQueue: Track[], startTrackId?: string) => {
  if (!nextQueue.length) return;
  tracks.value = nextQueue;
  const start = startTrackId ? nextQueue.find((t) => t.id === startTrackId) : nextQueue[0];
  if (!start) return;
  playTrack(start);
};

const playAllSongs = async () => {
  miniError.value = "";

  if (browseTracks.value.length === 0) {
    await fetchBrowseTracks();
  }

  const nextQueue = browseTracks.value;
  if (!nextQueue.length) return;
  setQueueAndPlay(nextQueue);
  miniPanelOpen.value = false;
};

const fetchPlaylists = async () => {
  try {
    let res = await authedJson(`${API_BASE.value}/playlists?take=1000`);
    if (!res.ok) {
      // Try alternative endpoint if needed
      res = await authedJson(`${API_BASE.value}/music/playlists?take=1000`);
    }

    if (res.ok) {
      const data = await res.json();
      const list = normalizeList(data);
      playlists.value = list.map((item: unknown) => {
        const i = item as RawItem;
        return {
          id: i.id,
          name: i.name || i.title || "未命名歌单",
          coverUrl: resolveUrl(i.coverUrl || i.cover),
        };
      });
    }
  } catch (e) {
    console.error("Fetch playlists failed", e);
  }
};

const fetchArtists = async () => {
  try {
    const res = await authedJson(`${API_BASE.value}/library/artists?take=1000`);
    if (res.ok) {
      const data = await res.json();
      const list = normalizeList(data);
      artists.value = list.map((item: unknown) => {
        const i = item as RawItem;
        return {
          id: i.id,
          name: i.name || i.artist || "Unknown Artist",
          coverUrl: resolveUrl(i.coverUrl || i.cover),
        };
      });
    }
  } catch (e) {
    console.error("Fetch artists failed", e);
  }
};

const fetchAlbums = async () => {
  try {
    const res = await authedJson(`${API_BASE.value}/library/albums?take=1000`);
    if (res.ok) {
      const data = await res.json();
      const list = normalizeList(data);
      albums.value = list.map((item: unknown) => {
        const i = item as RawItem;
        return {
          id: i.id,
          title: i.title || i.name || "Unknown Album",
          artist: i.artist as string | undefined,
          coverUrl: resolveUrl(i.coverUrl || i.cover),
        };
      });
    }
  } catch (e) {
    console.error("Fetch albums failed", e);
  }
};

const fetchTracks = async () => {
  if (!props.widget.data?.token && props.widget.data?.username && props.widget.data?.password) {
    await login();
  }

  loading.value = true;
  error.value = "";
  try {
    let url = `${API_BASE.value}/songs?take=1000`;
    if (libraryMode.value === "playlists" && currentPlaylistId.value) {
      url = `${API_BASE.value}/playlists/${currentPlaylistId.value}/tracks?take=1000`;
    } else if (libraryMode.value === "artists" && currentArtistId.value) {
      // 按照文档，获取艺术家详情：GET /library/artists/:id
      // 但文档并未明确列出 /library/artists/:id/songs 接口，
      // 根据 "2. 曲库与音频流" 中的 GET /tracks?skip&take&search，
      // 以及 "4. 媒体库" 中的 GET /library/artists/:id，
      // 实际上可能需要先获取艺术家详情，或者后端支持 /library/artists/:id/songs (猜测)
      // 如果后端严格按照文档，可能并没有直接获取艺术家下所有歌曲的接口，或者它是隐藏的。
      // 考虑到用户之前提到的 "接口使用/artists" 以及 "获取艺人的歌单"，
      // 假设存在 /library/artists/:id/songs 或 /library/artists/:id/tracks。
      // 如果文档中没有明确列出子资源 songs/tracks，
      // 另一种可能是使用通用搜索接口 /tracks?search=ArtistName
      // 或者 /tracks?artistId=... (文档未提及参数)

      // 观察文档 "2. 曲库与音频流" -> GET /tracks?skip&take&search
      // 观察文档 "4. 媒体库" -> GET /library/artists/:id
      // 并没有明确的 /library/artists/:id/songs。

      // 但根据用户上一轮的反馈，似乎认可了 /library/artists/:id/songs。
      // 再次查看文档，发现文档确实没有 /library/artists/:id/songs。
      // 文档中有 /playlists/:id/tracks。
      // 也许艺人详情页接口 /library/artists/:id 返回了 songs 列表？
      // 或者应该用 /tracks?search=...

      // 让我们仔细看文档。
      // 42. GET /library/artists、/library/artists/:id
      // 也许 /library/artists/:id 返回的 JSON 里包含了 songs?

      // 但为了保险，我们保留之前的尝试逻辑，并添加对 /tracks?search=ArtistName 的回退，
      // 前提是我们知道艺人的名字。

      // 暂时保持 /library/artists/:id/songs，但添加更强的回退逻辑：
      // 1. /library/artists/:id/songs
      // 2. /library/artists/:id/tracks
      // 3. /tracks?search={ArtistName}

      url = `${API_BASE.value}/library/artists/${currentArtistId.value}/songs?take=1000`;
    } else if (libraryMode.value === "albums" && currentAlbumId.value) {
      url = `${API_BASE.value}/library/albums/${currentAlbumId.value}`;
    }

    let res = await fetch(url, {
      headers: getHeaders(),
    });

    if (!res.ok) {
      // Fallback logic
      if (libraryMode.value === "playlists" && currentPlaylistId.value) {
        url = `${API_BASE.value}/playlists/${currentPlaylistId.value}/songs?take=1000`;
        res = await fetch(url, { headers: getHeaders() });
      } else if (libraryMode.value === "artists" && currentArtistId.value) {
        url = `${API_BASE.value}/library/artists/${currentArtistId.value}/tracks?take=1000`;
        res = await fetch(url, { headers: getHeaders() });

        if (!res.ok) {
          // Try search by artist name
          const artist = artists.value.find((a) => a.id === currentArtistId.value);
          if (artist && artist.name) {
            url = `${API_BASE.value}/tracks?search=${encodeURIComponent(artist.name)}&take=1000`;
            res = await fetch(url, { headers: getHeaders() });
          }
        }
      } else if (libraryMode.value === "albums" && currentAlbumId.value) {
        const album = albums.value.find((a) => a.id === currentAlbumId.value);
        if (album && album.title) {
          url = `${API_BASE.value}/tracks?search=${encodeURIComponent(album.title)}&take=1000`;
          res = await fetch(url, { headers: getHeaders() });
        }
      } else if (url.includes("/songs")) {
        url = url.replace("/songs", "/tracks");
        res = await fetch(url, { headers: getHeaders() });
      }
    }

    if (res.status === 401) {
      // Token expired or invalid, try login again
      await login();
      res = await fetch(url, {
        headers: getHeaders(),
      });
    }

    if (!res.ok) throw new Error(`API Error: ${res.status}`);
    const data = await res.json();
    const list = normalizeList(data);

    // Extra fallback for albums if list is empty
    if (list.length === 0 && libraryMode.value === "albums" && currentAlbumId.value) {
      const album = albums.value.find((a) => a.id === currentAlbumId.value);
      if (album && album.title) {
        const searchUrl = `${API_BASE.value}/tracks?search=${encodeURIComponent(album.title)}&take=1000`;
        const searchRes = await authedJson(searchUrl);
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const searchList = normalizeList(searchData);
          if (searchList.length > 0) {
            tracks.value = searchList.map(normalizeTrack).filter(Boolean) as Track[];
            loading.value = false;
            return;
          }
        }
      }
    }

    tracks.value = list.map(normalizeTrack).filter(Boolean) as Track[];

    // 如果收藏夹为空，尝试获取普通歌单作为后备 (only if not selecting specific playlist)
    if (tracks.value.length === 0 && !currentPlaylistId.value) {
      let fallbackRes = await fetch(`${API_BASE.value}/songs?take=100`, { headers: getHeaders() });
      if (!fallbackRes.ok)
        fallbackRes = await fetch(`${API_BASE.value}/tracks?take=100`, { headers: getHeaders() });
      if (fallbackRes.ok) {
        const fbData = await fallbackRes.json();
        const fbList = normalizeList(fbData);
        tracks.value = fbList.map(normalizeTrack).filter(Boolean) as Track[];
      }
    }

    if (tracks.value.length === 0) {
      error.value = "暂无歌曲，请检查 API 配置或收藏";
    }
  } catch (e) {
    console.error("Fetch tracks failed", e);
    error.value = `加载失败: ${(e as Error).message}`;
    tracks.value = [];
  } finally {
    loading.value = false;
  }
};

const setLibraryMode = (mode: string) => {
  libraryMode.value = mode as LibraryMode;
  currentPlaylistId.value = null;
  currentArtistId.value = null;
  currentAlbumId.value = null;

  if (mode === "playlists" && playlists.value.length === 0) fetchPlaylists();
  if (mode === "artists" && artists.value.length === 0) fetchArtists();
  if (mode === "albums" && albums.value.length === 0) fetchAlbums();

  if (mode === "songs") {
    fetchTracks();
  } else {
    tracks.value = [];
  }
};

const getModeName = (mode: string) => {
  const map: Record<string, string> = {
    songs: "歌曲",
    playlists: "歌单",
    artists: "艺人",
    albums: "专辑",
  };
  return map[mode] || mode;
};

const selectArtist = (id: string) => {
  currentArtistId.value = id;
  fetchTracks();
};

const selectAlbum = (id: string) => {
  currentAlbumId.value = id;
  fetchTracks();
};

const revokeAudioObjectUrl = () => {
  if (!audioObjectUrl.value) return;
  URL.revokeObjectURL(audioObjectUrl.value);
  audioObjectUrl.value = null;
  audioObjectUrlTrackId.value = null;
};

const loadViaBlob = async (trackId: string, startTime = 0, autoPlay = true) => {
  if (!audioRef.value) return;

  const urls = [
    `${API_BASE.value}/tracks/${encodeURIComponent(trackId)}/stream`,
    `${API_BASE.value}/songs/${encodeURIComponent(trackId)}/stream`,
  ];

  let res: Response | null = null;
  let lastErr: { status: number; detail: string } | null = null;

  for (const url of urls) {
    try {
      res = await authedJson(url);
    } catch (e) {
      throw new Error(`连接失败: ${(e as Error).message}`);
    }

    if (res.ok) {
      lastErr = null;
      break;
    }

    const raw = await res.text();
    let detail = raw;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.error === "string") detail = parsed.error;
      else detail = JSON.stringify(parsed);
    } catch {}

    lastErr = { status: res.status, detail };

    const maybeNotFound =
      res.status === 404 ||
      detail.includes("TRACK_NOT_FOUND") ||
      detail.toLowerCase().includes("not found");
    if (!maybeNotFound) break;
  }

  if (!res || !res.ok) {
    if (lastErr) throw new Error(`Stream API Error ${lastErr.status}: ${lastErr.detail}`);
    throw new Error("Stream API Error: 请求失败");
  }

  const contentType = res.headers.get("content-type") || "";
  // Relaxed content-type check, just warn
  if (
    contentType &&
    !contentType.startsWith("audio/") &&
    !contentType.startsWith("application/octet-stream") &&
    !contentType.startsWith("video/")
  ) {
    console.warn(`Unexpected content-type: ${contentType}`);
  }

  const blob = await res.blob();
  revokeAudioObjectUrl();
  audioObjectUrl.value = URL.createObjectURL(blob);
  audioObjectUrlTrackId.value = trackId;
  audioRef.value.src = audioObjectUrl.value;
  audioRef.value.currentTime = startTime;

  if (autoPlay) {
    try {
      await audioRef.value.play();
      error.value = ""; // Clear error on success
    } catch (e) {
      playerState.value.isPlaying = false;
      throw new Error(`Playback failed: ${(e as Error).name} - ${(e as Error).message}`);
    }
  }
};

const trackDetailById = ref<Record<string, Track>>({});

const fetchTrackDetail = async (trackId: string) => {
  if (trackDetailById.value[trackId]) return;
  try {
    let res = await authedJson(`${API_BASE.value}/tracks/${encodeURIComponent(trackId)}`);
    if (!res.ok) res = await authedJson(`${API_BASE.value}/songs/${encodeURIComponent(trackId)}`);
    if (!res.ok) return;
    const data = await res.json();
    const normalized = normalizeTrack(data);
    if (!normalized) return;
    trackDetailById.value = { ...trackDetailById.value, [trackId]: normalized };
  } catch {}
};

watch(
  () => playerState.value.currentTrackId,
  (id) => {
    if (!id) return;
    void fetchTrackDetail(id);
  },
  { immediate: true },
);

const resolveUrl = (url?: string): string | undefined => {
  if (!url) return undefined;
  const token = props.widget.data?.token;

  if (url.startsWith("http")) {
    const proxyUrl = `${API_BASE.value}/proxy-image?url=${encodeURIComponent(url)}`;
    return token ? `${proxyUrl}&token=${token}` : proxyUrl;
  }

  const baseUrl = API_BASE.value.replace(/\/api(\/v\d+)?$/, "");
  const fullUrl = url.startsWith("/") ? `${baseUrl}${url}` : `${baseUrl}/${url}`;
  return token ? `${fullUrl}${fullUrl.includes("?") ? "&" : "?"}token=${token}` : fullUrl;
};

const getCoverUrl = (track: Track): string | undefined => {
  const token = props.widget.data?.token;
  const detail = trackDetailById.value[track.id];
  const coverUrl = detail?.coverUrl || track.coverUrl;

  // If no coverUrl, try Subsonic fallback
  if (!coverUrl && track.id) {
    const url = `${API_BASE.value}/subsonic/rest/getCoverArt?id=track:${track.id}`;
    return token ? `${url}&token=${token}` : url;
  }

  return resolveUrl(coverUrl);
};

const currentTrack = computed(() =>
  tracks.value.find((t) => t.id === playerState.value.currentTrackId),
);

const currentTrackDetail = computed<Track | null>(() => {
  const track = currentTrack.value;
  if (!track) return null;
  return trackDetailById.value[track.id] ?? track;
});

watch(
  () => currentTrackDetail.value,
  (detail) => {
    if (detail) {
      if (detail.lyrics !== undefined) {
        playerState.value.lyrics = detail.lyrics;
      }
    }
  },
  { immediate: true },
);

const currentAlbumArtistText = computed(() => {
  const detail = currentTrackDetail.value;
  if (!detail) {
    if (libraryMode.value === "artists" && currentArtistId.value) {
      const artist = artists.value.find((a) => a.id === currentArtistId.value);
      return artist?.name || "";
    }
    return "";
  }
  let artist = detail.artist || "";
  if (Array.isArray(artist)) {
    artist = artist
      .map((a: unknown) => {
        if (typeof a === "string") return a;
        if (a && typeof a === "object") {
          const obj = a as Record<string, unknown>;
          if (typeof obj.name === "string") return obj.name;
        }
        return "";
      })
      .filter(Boolean)
      .join(", ");
  }
  artist = artist.trim();
  const album = (detail.album || "").trim();
  if (artist && album) return `${artist} · ${album}`;
  return artist || album || "";
});

// --- Lyrics Logic ---
const lyricsContainer = ref<HTMLElement | null>(null);
const activeLyricEl = ref<HTMLElement | null>(null);

const parsedLyrics = computed<LyricLine[]>(() => {
  if (!playerState.value.lyrics) return [];
  const lines = playerState.value.lyrics.split("\n");
  const result: LyricLine[] = [];
  const timeReg = /\[(\d+):(\d+)(?:[:.](\d+))?\]/g;

  lines.forEach((line) => {
    const text = line.replace(/\[(\d+):(\d+)(?:[:.](\d+))?\]/g, "").trim();
    if (!text) return;

    let match;
    timeReg.lastIndex = 0;
    while ((match = timeReg.exec(line)) !== null) {
      const min = parseInt(match[1] ?? "0", 10);
      const sec = parseInt(match[2] ?? "0", 10);
      const ms = match[3] ? parseInt(match[3], 10) : 0;
      // Handle both [mm:ss.xx] and [mm:ss.xxx]
      const time = min * 60 + sec + (ms > 99 ? ms / 1000 : ms / 100);
      result.push({ time, text });
    }
  });

  return result.sort((a, b) => a.time - b.time);
});

const activeLyricIndex = computed(() => {
  const time = playerState.value.currentTime;
  const lyrics = parsedLyrics.value;
  if (lyrics.length === 0) return -1;

  for (let i = lyrics.length - 1; i >= 0; i--) {
    const line = lyrics[i];
    if (!line) continue;
    if (time >= line.time) {
      return i;
    }
  }
  return 0;
});

watch(
  activeLyricIndex,
  async () => {
    if (!lyricsContainer.value) return;
    await nextTick();
    const container = lyricsContainer.value;
    const el = activeLyricEl.value;
    if (!el) return;
    // Shift the center point up by 60px to account for the bottom controls
    const centerPoint = container.offsetHeight / 2 - 60;
    const offset = el.offsetTop - centerPoint + el.offsetHeight / 2;
    container.scrollTo({
      top: Math.max(0, offset),
      behavior: isSeeking.value ? "auto" : "smooth",
    });
  },
  { immediate: true },
);

const missingTrackIds = new Set<string>();

const handleMissingTrack = async (track: Track) => {
  if (missingTrackIds.has(track.id)) return;
  missingTrackIds.add(track.id);

  if (audioRef.value) audioRef.value.pause();
  revokeAudioObjectUrl();

  const idx = tracks.value.findIndex((t) => t.id === track.id);
  if (idx !== -1) tracks.value.splice(idx, 1);

  playerState.value.currentTrackId = null;
  playerState.value.isPlaying = false;

  if (tracks.value.length > 0) {
    const next = tracks.value[Math.min(idx, tracks.value.length - 1)] || tracks.value[0];
    if (next) {
      await playTrack(next);
    }
    return;
  }

  await fetchTracks();
};

const playTrack = async (
  track: Track,
  options: { startTime?: number; autoPlay?: boolean } = {},
) => {
  const { startTime = 0, autoPlay = true } = options;

  if (playerState.value.currentTrackId === track.id && !startTime) {
    togglePlay();
    return;
  }

  playerState.value.currentTrackId = track.id;
  playerState.value.isPlaying = autoPlay;
  store.activeMusicPlayer = "music-widget";

  if (audioRef.value) {
    // If we are about to load a new blob, and the current src is a blob (even from previous instance), revoke it to prevent leaks
    if (audioRef.value.src && audioRef.value.src.startsWith("blob:")) {
      URL.revokeObjectURL(audioRef.value.src);
    }
    revokeAudioObjectUrl();

    // Directly use loadViaBlob because we know the API requires Auth Headers
    // and <audio> tag cannot send headers.
    try {
      await loadViaBlob(track.id, startTime, autoPlay);
    } catch (e) {
      console.error("Play error", e);
      const msg = (e as Error).message;
      if (msg.includes("TRACK_NOT_FOUND")) {
        error.value = "歌曲不存在，已跳过";
        await handleMissingTrack(track);
        return;
      }
      if (msg.includes("NotAllowedError") || msg.toLowerCase().includes("playback failed")) {
        playerState.value.isPlaying = false;
      }
      error.value = `播放出错: ${msg}`;

      // Fallback: If blob failed, maybe try transcode to mp3?
      // Only if the error suggests format issue, but for now just show error.
    }
  }
};

const quickStart = async () => {
  if (browseTracks.value.length === 0) await fetchBrowseTracks();
  if (browseTracks.value.length === 0) return false;
  await playAllSongs();
  return true;
};

const togglePlay = () => {
  if (!audioRef.value) return;
  if (!playerState.value.currentTrackId) {
    const first = tracks.value[0];
    if (first) {
      playTrack(first);
      return;
    }
    void (async () => {
      const ok = await quickStart();
      if (!ok) await fetchTracks();
    })();
    return;
  }
  if (playerState.value.isPlaying) {
    audioRef.value.pause();
    playerState.value.isPlaying = false;
    // apiPause();
  } else {
    audioRef.value.play().catch(() => {});
    playerState.value.isPlaying = true;
    store.activeMusicPlayer = "music-widget";
    // apiPlay();
  }
};

const toggleMode = () => {
  const modes: ("sequence" | "random" | "single")[] = ["sequence", "random", "single"];
  const nextIndex = (modes.indexOf(playerState.value.playbackMode) + 1) % modes.length;
  playerState.value.playbackMode = modes[nextIndex] as PlayerState["playbackMode"];
};

const nextTrack = (isAuto = false) => {
  if (!tracks.value.length) return;

  // Single Loop (only triggers on auto-advance, user click still goes next)
  if (isAuto && playerState.value.playbackMode === "single") {
    if (audioRef.value) {
      audioRef.value.currentTime = 0;
      audioRef.value.play().catch(() => {});
    }
    return;
  }

  // Random
  if (playerState.value.playbackMode === "random") {
    const nextIdx = Math.floor(Math.random() * tracks.value.length);
    const track = tracks.value[nextIdx];
    if (track) playTrack(track);
    if (syncPlayerState.value) void apiNext();
    return;
  }

  // Sequence
  const idx = tracks.value.findIndex((t) => t.id === playerState.value.currentTrackId);
  const nextIdx = (idx + 1) % tracks.value.length;
  const track = tracks.value[nextIdx];
  if (track) playTrack(track);
  if (syncPlayerState.value) void apiNext();
};

const prevTrack = () => {
  if (!tracks.value.length) return;
  const idx = tracks.value.findIndex((t) => t.id === playerState.value.currentTrackId);
  const prevIdx = (idx - 1 + tracks.value.length) % tracks.value.length;
  const track = tracks.value[prevIdx];
  if (track) playTrack(track);
  if (syncPlayerState.value) void apiPrev();
};

// --- Storage Logic ---
const STORAGE_KEY = "flatnas_music_player_state";

const savePlaybackState = useDebounceFn(() => {
  const state = {
    libraryMode: libraryMode.value,
    currentPlaylistId: currentPlaylistId.value,
    currentArtistId: currentArtistId.value,
    currentAlbumId: currentAlbumId.value,
    playerState: {
      volume: playerState.value.volume,
      playbackMode: playerState.value.playbackMode,
      currentTrackId: playerState.value.currentTrackId,
      currentTime: playerState.value.currentTime,
      isPlaying: playerState.value.isPlaying, // We try to save this to auto-resume
    },
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}, 1000);

// Immediate save for non-time updates
const savePlaybackStateImmediate = () => {
  const state = {
    libraryMode: libraryMode.value,
    currentPlaylistId: currentPlaylistId.value,
    currentArtistId: currentArtistId.value,
    currentAlbumId: currentAlbumId.value,
    playerState: {
      volume: playerState.value.volume,
      playbackMode: playerState.value.playbackMode,
      currentTrackId: playerState.value.currentTrackId,
      currentTime: playerState.value.currentTime,
      isPlaying: playerState.value.isPlaying,
    },
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

const restorePlaybackState = async () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try {
    const saved = JSON.parse(raw);

    // Restore context
    libraryMode.value = saved.libraryMode || "songs";
    currentPlaylistId.value = saved.currentPlaylistId || null;
    currentArtistId.value = saved.currentArtistId || null;
    currentAlbumId.value = saved.currentAlbumId || null;

    // Restore player config
    if (saved.playerState) {
      playerState.value.volume = saved.playerState.volume ?? 0.7;
      playerState.value.playbackMode = saved.playerState.playbackMode || "sequence";

      // If we have a track ID, we need to load tracks first then play
      if (saved.playerState.currentTrackId) {
        // Fetch tracks based on restored context
        await fetchTracks();

        const track = tracks.value.find((t) => t.id === saved.playerState.currentTrackId);
        if (track) {
          // Play from saved time
          // If it was playing, try to autoplay. If paused, just load.
          await playTrack(track, {
            startTime: saved.playerState.currentTime || 0,
            autoPlay: saved.playerState.isPlaying,
          });

          // Force time update in UI just in case
          playerState.value.currentTime = saved.playerState.currentTime || 0;
          return true;
        }
      }
    }
  } catch (e) {
    console.error("Failed to restore playback state", e);
  }
  return false;
};

// --- Audio Events ---
const isSeeking = ref(false);
const seekPreviewTime = ref(0);

const onTimeUpdate = () => {
  if (audioRef.value) {
    if (!isSeeking.value) {
      playerState.value.currentTime = audioRef.value.currentTime;
    }
    playerState.value.duration = audioRef.value.duration || 0;
    updateBuffered();
  }
};

const onEnded = () => {
  nextTrack(true);
};

const onVolumeChange = (e: Event) => {
  const el = e.target as HTMLInputElement;
  playerState.value.volume = parseFloat(el.value);
  if (audioRef.value) audioRef.value.volume = playerState.value.volume;
  if (syncPlayerState.value) void apiVolume(playerState.value.volume);
};

const onAudioPlay = () => {
  if (syncPlayerState.value) void apiPlay(playerState.value.currentTrackId || undefined);
};

const onAudioPause = () => {
  if (syncPlayerState.value) void apiPause();
};

const onAudioError = () => {
  const trackId = playerState.value.currentTrackId;
  if (trackId && audioObjectUrlTrackId.value !== trackId) {
    void loadViaBlob(trackId).catch((e) => {
      const msg = (e as Error).message || "";
      if (msg.includes("TRACK_NOT_FOUND")) {
        const track = tracks.value.find((t) => t.id === trackId);
        if (track) void handleMissingTrack(track);
        error.value = "歌曲不存在，已跳过";
        return;
      }
      error.value = "音频源不支持或无权限";
    });
    return;
  }
  error.value = "音频源不支持或无权限";
};

const onSeek = (e: Event) => {
  const el = e.target as HTMLInputElement;
  const time = parseFloat(el.value);
  if (isNaN(time)) return;
  isSeeking.value = true;
  seekPreviewTime.value = time;
  playerState.value.currentTime = time;
};

const onSeekCommit = (e?: Event) => {
  const eventTime = e ? parseFloat((e.target as HTMLInputElement).value) : NaN;
  const time = !isNaN(eventTime) ? eventTime : seekPreviewTime.value;
  if (audioRef.value && !isNaN(time)) {
    audioRef.value.currentTime = time;
    playerState.value.currentTime = time;
  }
  isSeeking.value = false;
};

const onGlobalPointerUp = () => {
  if (!isSeeking.value) return;
  onSeekCommit();
};

const onGlobalClick = () => {
  miniVolumeOpen.value = false;
};

const updateBuffered = () => {
  const audio = audioRef.value;
  if (
    !audio ||
    !audio.duration ||
    audio.duration <= 0 ||
    !audio.buffered ||
    audio.buffered.length === 0
  ) {
    bufferedTime.value = 0;
    return;
  }
  try {
    bufferedTime.value = audio.buffered.end(audio.buffered.length - 1);
  } catch {
    bufferedTime.value = 0;
  }
};

const onProgress = () => {
  updateBuffered();
};

const onBarClick = (e: MouseEvent) => {
  const el = e.currentTarget as HTMLElement | null;
  const d = playerState.value.duration || 0;
  if (!el || !d) return;
  const rect = el.getBoundingClientRect();
  if (!rect.width) return;
  const ratio = (e.clientX - rect.left) / rect.width;
  const nextTime = Math.max(0, Math.min(d, ratio * d));
  if (audioRef.value) audioRef.value.currentTime = nextTime;
  playerState.value.currentTime = nextTime;
};

const formatTime = (s: number) => {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

let pollTimer: number | null = null;

const startPolling = () => {
  if (pollTimer != null) return;
  pollTimer = window.setInterval(fetchPlayerState, 3000);
};

const stopPolling = () => {
  if (pollTimer == null) return;
  window.clearInterval(pollTimer);
  pollTimer = null;
};

onMounted(() => {
  const globalEl = document.getElementById("flatnas-global-audio") as HTMLAudioElement | null;
  if (globalEl) {
    useGlobalAudio.value = true;
    audioRef.value = globalEl;
    globalEl.addEventListener("timeupdate", onTimeUpdate);
    globalEl.addEventListener("ended", onEnded);
    globalEl.addEventListener("play", onAudioPlay);
    globalEl.addEventListener("pause", onAudioPause);
    globalEl.addEventListener("progress", onProgress);
    globalEl.addEventListener("error", onAudioError);
    if (!globalEl.paused) {
      playerState.value.isPlaying = true;
      playerState.value.currentTime = globalEl.currentTime;
      store.activeMusicPlayer = "music-widget";
    }
  } else {
    audioRef.value = localAudioRef.value;
  }

  fetchTracks();
  fetchPlaylists();
  if (syncPlayerState.value) {
    fetchPlayerState();
    startPolling();
  }
  if (isMiniSmall.value || isTallMini.value) {
    void fetchBrowseTracks();
    if (!syncPlayerState.value) void playAllSongs();
  }

  // Restore state logic
  if (!useGlobalAudio.value && !syncPlayerState.value) {
    // Only restore if not using global audio and not syncing with server
    restorePlaybackState().then((restored) => {
      if (!restored) {
        // Default behavior if no restore
        if (!isMiniSmall.value && !isTallMini.value) {
          // Already called fetchTracks above, but might need to ensure something selected?
          // Actually fetchTracks is enough to show list.
        }
      }
    });
  }

  // 点击外部关闭音量面板
  window.addEventListener("click", onGlobalClick);
  window.addEventListener("pointerup", onGlobalPointerUp);
});

// Watchers for State Saving
watch(
  () => playerState.value.currentTime,
  () => {
    savePlaybackState();
  },
);

watch(
  [
    () => playerState.value.currentTrackId,
    () => playerState.value.volume,
    () => playerState.value.playbackMode,
    () => playerState.value.isPlaying,
    libraryMode,
    currentPlaylistId,
    currentArtistId,
    currentAlbumId,
  ],
  () => {
    savePlaybackStateImmediate();
  },
);

onUnmounted(() => {
  stopPolling();
  if (useGlobalAudio.value) {
    // If using global audio, do NOT revoke object URL to allow persistent playback.
    // Also remove listeners from global element to avoid leaks/errors
    const globalEl = audioRef.value;
    if (globalEl) {
      globalEl.removeEventListener("timeupdate", onTimeUpdate);
      globalEl.removeEventListener("ended", onEnded);
      globalEl.removeEventListener("play", onAudioPlay);
      globalEl.removeEventListener("pause", onAudioPause);
      globalEl.removeEventListener("progress", onProgress);
      globalEl.removeEventListener("error", onAudioError);
    }
  } else {
    revokeAudioObjectUrl();
  }
  window.removeEventListener("click", onGlobalClick);
  window.removeEventListener("pointerup", onGlobalPointerUp);
});

watch(syncPlayerState, (enabled) => {
  if (enabled) {
    fetchPlayerState();
    startPolling();
  } else {
    stopPolling();
  }
});
</script>

<template>
  <div
    class="w-full h-full backdrop-blur-md border border-white/20 rounded-2xl flex flex-col overflow-hidden shadow-lg hover:shadow-xl transition-all group relative"
    :style="{ backgroundColor: `rgba(255, 255, 255, ${(widget.opacity ?? 0.1) * 0.4})` }"
  >
    <!-- Background Layer -->
    <div
      v-if="currentCoverUrl"
      class="absolute inset-0 bg-cover bg-center transition-all duration-700 blur-md opacity-80 pointer-events-none"
      :style="{ backgroundImage: `url('${currentCoverUrl}')` }"
    ></div>
    <div v-else class="absolute inset-0 bg-white/5 transition-all pointer-events-none"></div>

    <!-- Audio Element (Hidden) -->
    <audio
      ref="localAudioRef"
      @timeupdate="onTimeUpdate"
      @ended="onEnded"
      @play="onAudioPlay"
      @pause="onAudioPause"
      @progress="onProgress"
      @error="onAudioError"
      crossorigin="anonymous"
    ></audio>

    <!-- Header / Now Playing -->
    <template v-if="widget.colSpan === 1 && widget.rowSpan === 1">
      <!-- Mini Mode (1x1) -->
      <div class="w-full h-full relative z-10">
        <div class="aplayer aplayer-mini" :class="{ 'aplayer-withlist': miniListOpen }">
          <div class="aplayer-body">
            <div class="aplayer-pic">
              <button
                class="aplayer-pic-btn"
                @click.stop="togglePlay"
                :title="playerState.isPlaying ? '暂停' : '播放'"
                :style="
                  currentCoverUrl ? { backgroundImage: `url('${currentCoverUrl}')` } : undefined
                "
              >
                <span class="aplayer-pic-icon" :class="{ 'is-playing': playerState.isPlaying }">{{
                  playerState.isPlaying ? ICON_PAUSE : ICON_PLAY
                }}</span>
              </button>
            </div>

            <div class="aplayer-info">
              <div class="aplayer-music-text-wrap">
                <span
                  class="aplayer-title"
                  :class="{ 'aplayer-marquee': (currentTrack?.title || '').length > 15 }"
                >
                  {{ currentTrack?.title || "选择播放" }}
                  <span v-if="(currentTrack?.title || '').length > 15" class="ml-8">{{
                    currentTrack?.title
                  }}</span>
                </span>
              </div>
              <div class="aplayer-music-text-wrap">
                <span
                  class="aplayer-author"
                  :class="{ 'aplayer-marquee': currentAlbumArtistText.length > 20 }"
                >
                  {{ currentAlbumArtistText }}
                  <span v-if="currentAlbumArtistText.length > 20" class="ml-8">{{
                    currentAlbumArtistText
                  }}</span>
                </span>
              </div>
              <div v-if="error" class="text-xs text-red-400 mt-0.5 truncate" :title="error">
                {{ error }}
              </div>

              <div class="aplayer-time-main">
                <div class="aplayer-controls">
                  <button class="aplayer-btn" @click.stop="prevTrack" title="上一首">
                    {{ ICON_PREV }}
                  </button>
                  <button class="aplayer-btn" @click.stop="nextTrack()" title="下一首">
                    {{ ICON_NEXT }}
                  </button>
                </div>

                <div class="aplayer-right">
                  <button
                    class="aplayer-btn"
                    @click.stop="toggleMode"
                    :title="
                      playerState.playbackMode === 'random'
                        ? '随机播放'
                        : playerState.playbackMode === 'single'
                          ? '单曲循环'
                          : '顺序播放'
                    "
                  >
                    {{
                      playerState.playbackMode === "random"
                        ? ICON_MODE_RANDOM
                        : playerState.playbackMode === "single"
                          ? ICON_MODE_SINGLE
                          : ICON_MODE_SEQUENCE
                    }}
                  </button>

                  <div class="aplayer-volume">
                    <button
                      class="aplayer-btn"
                      @click.stop="miniVolumeOpen = !miniVolumeOpen"
                      title="音量"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        class="w-5 h-5"
                      >
                        <path
                          d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
                        />
                      </svg>
                    </button>
                    <div v-show="miniVolumeOpen" class="aplayer-volume-panel" @click.stop>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        :value="playerState.volume"
                        @input="onVolumeChange"
                        class="aplayer-volume-slider"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div class="aplayer-bar-container">
                <div class="aplayer-bar-wrap" @click.stop="onBarClick">
                  <div class="aplayer-bar">
                    <div class="aplayer-loaded" :style="{ width: `${loadedPercent}%` }"></div>
                    <div class="aplayer-played" :style="{ width: `${playedPercent}%` }">
                      <span class="aplayer-thumb"></span>
                    </div>
                    <input
                      class="aplayer-seek"
                      type="range"
                      :min="0"
                      :max="playerState.duration || 0"
                      :value="playerState.currentTime"
                      :disabled="!playerState.duration"
                      step="0.1"
                      @input="onSeek"
                      @change="onSeekCommit"
                    />
                  </div>
                </div>
                <span class="aplayer-ptime">{{ formatTime(playerState.currentTime) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="widget.colSpan === 1 && widget.rowSpan === 3">
      <div class="w-full h-full relative z-10">
        <div class="aplayer aplayer-mini is-tall" :class="{ 'aplayer-withlist': miniListOpen }">
          <div class="aplayer-body">
            <div class="aplayer-pic">
              <button
                class="aplayer-pic-btn"
                @click.stop="togglePlay"
                :title="playerState.isPlaying ? '暂停' : '播放'"
                :style="
                  currentCoverUrl ? { backgroundImage: `url('${currentCoverUrl}')` } : undefined
                "
              >
                <span class="aplayer-pic-icon" :class="{ 'is-playing': playerState.isPlaying }">{{
                  playerState.isPlaying ? ICON_PAUSE : ICON_PLAY
                }}</span>
              </button>
            </div>

            <div class="aplayer-info">
              <div class="aplayer-music-text-wrap">
                <span
                  class="aplayer-title"
                  :class="{ 'aplayer-marquee': (currentTrack?.title || '').length > 15 }"
                >
                  {{ currentTrack?.title || "选择播放" }}
                  <span v-if="(currentTrack?.title || '').length > 15" class="ml-8">{{
                    currentTrack?.title
                  }}</span>
                </span>
              </div>
              <div class="aplayer-music-text-wrap">
                <span
                  class="aplayer-author"
                  :class="{ 'aplayer-marquee': currentAlbumArtistText.length > 20 }"
                >
                  {{ currentAlbumArtistText }}
                  <span v-if="currentAlbumArtistText.length > 20" class="ml-8">{{
                    currentAlbumArtistText
                  }}</span>
                </span>
              </div>

              <div class="aplayer-time-main">
                <div class="aplayer-controls">
                  <button class="aplayer-btn" @click.stop="prevTrack" title="上一首">
                    {{ ICON_PREV }}
                  </button>
                  <button class="aplayer-btn" @click.stop="nextTrack()" title="下一首">
                    {{ ICON_NEXT }}
                  </button>
                </div>

                <div class="aplayer-right">
                  <button
                    class="aplayer-btn"
                    @click.stop="toggleMode"
                    :title="
                      playerState.playbackMode === 'random'
                        ? '随机播放'
                        : playerState.playbackMode === 'single'
                          ? '单曲循环'
                          : '顺序播放'
                    "
                  >
                    {{
                      playerState.playbackMode === "random"
                        ? ICON_MODE_RANDOM
                        : playerState.playbackMode === "single"
                          ? ICON_MODE_SINGLE
                          : ICON_MODE_SEQUENCE
                    }}
                  </button>

                  <div class="aplayer-volume">
                    <button
                      class="aplayer-btn"
                      @click.stop="miniVolumeOpen = !miniVolumeOpen"
                      title="音量"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        class="w-5 h-5"
                      >
                        <path
                          d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
                        />
                      </svg>
                    </button>
                    <div v-show="miniVolumeOpen" class="aplayer-volume-panel" @click.stop>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        :value="playerState.volume"
                        @input="onVolumeChange"
                        class="aplayer-volume-slider"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div class="aplayer-bar-container">
                <div class="aplayer-bar-wrap" @click.stop="onBarClick">
                  <div class="aplayer-bar">
                    <div class="aplayer-loaded" :style="{ width: `${loadedPercent}%` }"></div>
                    <div class="aplayer-played" :style="{ width: `${playedPercent}%` }">
                      <span class="aplayer-thumb"></span>
                    </div>
                    <input
                      class="aplayer-seek"
                      type="range"
                      :min="0"
                      :max="playerState.duration || 0"
                      :value="playerState.currentTime"
                      :disabled="!playerState.duration"
                      step="0.1"
                      @input="onSeek"
                      @change="onSeekCommit"
                    />
                  </div>
                </div>
                <span class="aplayer-ptime">{{ formatTime(playerState.currentTime) }}</span>
              </div>
            </div>
          </div>

          <div v-show="miniListOpen" class="aplayer-list" @click.stop>
            <div class="aplayer-list-body">
              <div v-if="miniLoading" class="aplayer-list-state">加载中...</div>
              <div v-else-if="miniError" class="aplayer-list-state is-error">{{ miniError }}</div>

              <div v-else class="aplayer-list-state">
                已加载全部歌曲（{{ browseTracks.length }}）
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <!-- Standard Mode (2x3 or larger) -->
      <div class="flex h-full relative z-10">
        <!-- Left Column: Player & Playlist -->
        <div
          class="flex flex-col min-w-0 transition-all duration-300 w-[39.2%] border-r border-white/10"
        >
          <!-- Now Playing Info & Progress -->
          <div class="border-b border-white/10 bg-white/5 flex flex-col shrink-0">
            <!-- Info -->
            <div class="p-3 flex gap-1.5 items-center relative">
              <div
                class="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center overflow-hidden shadow-sm shrink-0"
              >
                <img
                  v-if="currentCoverUrl"
                  :src="currentCoverUrl"
                  class="w-full h-full object-cover"
                />
                <img v-else src="/daoliyu.png" class="w-6 h-6 object-contain opacity-50" />
              </div>
              <div class="flex-1 min-w-0 flex flex-col">
                <div class="font-bold text-white truncate text-sm leading-tight">
                  {{ currentTrack?.title || "道理鱼音乐" }}
                </div>
                <div class="text-xs text-white/60 truncate leading-tight">
                  {{ currentAlbumArtistText || (currentTrack ? "" : "未播放") }}
                </div>
              </div>

              <!-- Playback Mode Button -->
              <button
                @click="toggleMode"
                class="absolute bottom-1 right-2 flex items-center justify-center text-[12px] scale-[1.8] transition-all duration-200 ease-out text-white/50 hover:text-white/90"
                :title="
                  playerState.playbackMode === 'random'
                    ? '随机播放'
                    : playerState.playbackMode === 'single'
                      ? '循环播放'
                      : '顺序播放'
                "
              >
                {{
                  playerState.playbackMode === "random"
                    ? "⥮"
                    : playerState.playbackMode === "single"
                      ? "⟳"
                      : "⇉"
                }}
              </button>
            </div>

            <!-- Progress -->
            <div class="px-1 pb-2">
              <div class="flex items-center gap-1 text-[12px] text-white/70">
                <span class="tabular-nums w-9 text-right">{{
                  formatTime(playerState.currentTime)
                }}</span>
                <input
                  type="range"
                  :max="playerState.duration || 100"
                  :value="playerState.currentTime"
                  @input="onSeek"
                  @change="onSeekCommit"
                  class="flex-1 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-blue-500 min-w-0"
                />
                <span class="tabular-nums w-9">{{ formatTime(playerState.duration) }}</span>
              </div>
            </div>
          </div>

          <!-- Library Selection -->
          <div class="px-3 py-1.5 border-b border-white/10 bg-white/5 flex flex-col gap-1.5">
            <!-- Mode Selector -->
            <div class="flex gap-1 overflow-x-auto custom-scrollbar pb-0.5">
              <button
                v-for="mode in ['songs', 'artists', 'albums']"
                :key="mode"
                @click="setLibraryMode(mode)"
                class="px-2 py-0.5 text-[10px] rounded whitespace-nowrap transition-colors"
                :class="
                  libraryMode === mode
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'bg-white/10 text-white/60 hover:bg-white/20'
                "
              >
                {{ getModeName(mode) }}
              </button>
            </div>

            <!-- Item Selector -->
            <select
              v-if="libraryMode === 'playlists'"
              v-model="currentPlaylistId"
              @change="fetchTracks"
              class="w-full bg-black/20 text-white/90 text-xs rounded px-2 py-1 outline-none border border-white/10 focus:border-blue-500/50 hover:bg-black/30 transition-colors"
            >
              <option :value="null" class="text-black">请选择歌单...</option>
              <option v-for="p in playlists" :key="p.id" :value="p.id" class="text-black">
                {{ p.name }}
              </option>
            </select>
          </div>

          <!-- Playlist -->
          <div class="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar" @wheel.stop>
            <div v-if="loading" class="p-4 text-center text-xs text-white/40">加载中...</div>
            <div v-else-if="error" class="p-4 text-center text-xs text-red-400">{{ error }}</div>
            <div v-else>
              <div
                v-if="libraryMode === 'artists' && !currentArtistId"
                class="grid grid-cols-3 gap-2 p-2"
              >
                <div
                  v-for="a in artists"
                  :key="a.id"
                  @click="selectArtist(a.id)"
                  class="flex flex-col items-center gap-1 cursor-pointer group hover:bg-white/5 p-2 rounded-lg transition-colors"
                >
                  <div
                    class="w-14 h-14 rounded-full overflow-hidden bg-white/10 shadow-sm group-hover:scale-105 transition-transform border border-white/5"
                  >
                    <img v-if="a.coverUrl" :src="a.coverUrl" class="w-full h-full object-cover" />
                    <div
                      v-else
                      class="w-full h-full flex items-center justify-center text-2xl opacity-50"
                    >
                      👤
                    </div>
                  </div>
                  <span class="text-[10px] text-white/80 text-center truncate w-full">{{
                    a.name
                  }}</span>
                </div>
              </div>

              <div
                v-else-if="libraryMode === 'albums' && !currentAlbumId"
                class="grid grid-cols-3 gap-2 p-2"
              >
                <div
                  v-for="a in albums"
                  :key="a.id"
                  @click="selectAlbum(a.id)"
                  class="flex flex-col items-center gap-1 cursor-pointer group hover:bg-white/5 p-2 rounded-lg transition-colors"
                >
                  <div
                    class="w-14 h-14 rounded overflow-hidden bg-white/10 shadow-sm group-hover:scale-105 transition-transform border border-white/5"
                  >
                    <img v-if="a.coverUrl" :src="a.coverUrl" class="w-full h-full object-cover" />
                    <div
                      v-else
                      class="w-full h-full flex items-center justify-center text-2xl opacity-50"
                    >
                      💿
                    </div>
                  </div>
                  <span class="text-[10px] text-white/80 text-center truncate w-full">{{
                    a.title
                  }}</span>
                </div>
              </div>

              <div v-else>
                <div
                  v-if="libraryMode === 'artists' && currentArtistId"
                  class="sticky top-0 z-10 bg-black/40 backdrop-blur-md border-b border-white/10 px-3 py-2 flex items-center gap-2 mb-1"
                >
                  <button
                    @click="currentArtistId = null"
                    class="w-5 h-5 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 transition-colors text-xs"
                    title="返回"
                  >
                    ←
                  </button>
                  <div class="flex items-center gap-2 overflow-hidden flex-1">
                    <img
                      v-if="artists.find((a) => a.id === currentArtistId)?.coverUrl"
                      :src="artists.find((a) => a.id === currentArtistId)?.coverUrl"
                      class="w-5 h-5 rounded-full object-cover border border-white/10"
                    />
                    <span class="text-xs font-bold text-white truncate">
                      {{ artists.find((a) => a.id === currentArtistId)?.name || "艺人歌单" }}
                    </span>
                  </div>
                  <button
                    @click="playAll"
                    class="text-[10px] bg-blue-500 hover:bg-blue-600 text-white px-2 py-0.5 rounded shadow-sm transition-colors"
                  >
                    播放全部
                  </button>
                </div>

                <div
                  v-if="libraryMode === 'albums' && currentAlbumId"
                  class="sticky top-0 z-10 bg-black/40 backdrop-blur-md border-b border-white/10 px-3 py-2 flex items-center gap-2 mb-1"
                >
                  <button
                    @click="currentAlbumId = null"
                    class="w-5 h-5 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 transition-colors text-xs"
                    title="返回"
                  >
                    ←
                  </button>
                  <div class="flex items-center gap-2 overflow-hidden flex-1">
                    <img
                      v-if="albums.find((a) => a.id === currentAlbumId)?.coverUrl"
                      :src="albums.find((a) => a.id === currentAlbumId)?.coverUrl"
                      class="w-5 h-5 rounded object-cover border border-white/10"
                    />
                    <span class="text-xs font-bold text-white truncate">
                      {{ albums.find((a) => a.id === currentAlbumId)?.title || "专辑歌单" }}
                    </span>
                  </div>
                  <button
                    @click="playAll"
                    class="text-[10px] bg-blue-500 hover:bg-blue-600 text-white px-2 py-0.5 rounded shadow-sm transition-colors"
                  >
                    播放全部
                  </button>
                </div>

                <div
                  v-for="(track, idx) in tracks"
                  :key="track.id"
                  @click="playTrack(track)"
                  class="px-3 py-0.5 hover:bg-white/10 cursor-pointer flex items-center gap-1.5 transition-colors group/item"
                  :class="{ 'bg-blue-500/20': currentTrack?.id === track.id }"
                >
                  <div class="text-xs text-white/40 w-4 text-center">
                    <span
                      v-if="currentTrack?.id === track.id && playerState.isPlaying"
                      class="animate-pulse text-blue-400"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        class="w-3.5 h-3.5 inline-block"
                      >
                        <path
                          d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
                        />
                      </svg>
                    </span>
                    <span v-else>{{ idx + 1 }}</span>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div
                      class="text-xs font-medium text-white/90 truncate"
                      :class="{ 'text-blue-400': currentTrack?.id === track.id }"
                    >
                      {{ track.title }}
                    </div>
                    <div class="text-[10px] text-white/50 truncate">{{ track.artist }}</div>
                  </div>
                  <div
                    class="text-[10px] text-white/40 opacity-0 group-hover/item:opacity-100 transition-opacity"
                  >
                    {{ formatTime(track.duration || 0) }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right Column: Lyrics -->
        <div class="w-[61.8%] flex flex-col bg-black/10 h-full relative" @wheel.stop>
          <!-- Visual Mode Switcher -->
          <div
            class="absolute top-4 right-4 z-30 transition-opacity duration-300"
            :class="[showVisualModeMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100']"
          >
            <button
              @click="showVisualModeMenu = !showVisualModeMenu"
              class="w-8 h-8 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white/70 hover:text-white hover:bg-black/60 transition-all border border-white/10"
              title="切换播放效果"
            >
              {{ visualModeOptions.find((o) => o.id === visualMode)?.icon || "🎨" }}
            </button>

            <!-- Dropdown Menu -->
            <div
              v-if="showVisualModeMenu"
              class="absolute right-0 mt-2 w-40 bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl py-1 z-40 overflow-hidden"
            >
              <button
                v-for="opt in visualModeOptions"
                :key="opt.id"
                @click="toggleVisualMode(opt.id as VisualMode)"
                class="w-full px-4 py-2.5 text-left text-xs flex items-center gap-3 transition-colors hover:bg-white/10"
                :class="
                  visualMode === opt.id ? 'text-blue-400 font-bold bg-white/5' : 'text-white/70'
                "
              >
                <span class="text-sm">{{ opt.icon }}</span>
                <span>{{ opt.label }}</span>
              </button>
            </div>
          </div>

          <!-- Lyrics Mode -->
          <div
            v-if="visualMode === 'lyrics'"
            ref="lyricsContainer"
            class="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar p-4 text-center scroll-smooth"
          >
            <div v-if="parsedLyrics.length > 0" class="pt-[40%] pb-[60%]">
              <div
                v-for="(line, index) in parsedLyrics"
                :key="index"
                :class="[
                  'transition-all duration-500 py-2 text-sm leading-relaxed tracking-wide origin-center break-words',
                  index === activeLyricIndex
                    ? 'text-white font-bold scale-[1.5] opacity-100'
                    : index === activeLyricIndex + 1
                      ? 'text-white/90 font-bold scale-[1.3] opacity-90'
                      : index < activeLyricIndex
                        ? 'text-white/80 font-bold scale-[1.1] opacity-80'
                        : 'text-white/35 opacity-50',
                ]"
                :ref="
                  (el) => {
                    if (index === activeLyricIndex) activeLyricEl = el as HTMLElement;
                  }
                "
              >
                {{ line.text }}
              </div>
            </div>
            <div
              v-else-if="playerState.lyrics"
              class="text-xs text-white/90 whitespace-pre-line leading-7 font-medium tracking-wide"
            >
              {{ playerState.lyrics }}
            </div>
            <div
              v-else
              class="h-full flex flex-col items-center justify-center text-white/40 gap-2"
            >
              <span class="text-2xl opacity-50">📝</span>
              <span class="text-xs">暂无歌词</span>
            </div>
          </div>

          <!-- Spectrum Analyzer Mode -->
          <div
            v-else-if="visualMode === 'spectrum'"
            class="flex-1 flex flex-col items-center justify-center p-4"
          >
            <div class="text-white/40 flex flex-col items-center gap-6">
              <div class="flex items-end gap-1.5 h-20">
                <div
                  v-for="i in 12"
                  :key="i"
                  class="w-1.5 bg-gradient-to-t from-blue-600/40 to-blue-400/80 rounded-t-sm animate-pulse"
                  :style="{
                    height: `${20 + Math.random() * 80}%`,
                    animationDuration: `${0.5 + Math.random() * 1}s`,
                  }"
                ></div>
              </div>
              <div class="flex flex-col items-center gap-2 w-full max-w-[80%]">
                <div
                  v-if="parsedLyrics.length > 0 && activeLyricIndex >= 0"
                  class="flex flex-col items-center gap-2"
                >
                  <!-- Current Lyric -->
                  <div class="text-sm font-bold text-white text-center drop-shadow-md">
                    {{ parsedLyrics[activeLyricIndex]?.text }}
                  </div>
                  <!-- Next Lyric Preview -->
                  <div
                    v-if="parsedLyrics[activeLyricIndex + 1]"
                    class="text-[11px] text-white/40 text-center line-clamp-1 italic"
                  >
                    {{ parsedLyrics[activeLyricIndex + 1]?.text }}
                  </div>
                </div>
                <div v-else class="flex flex-col items-center gap-1">
                  <span class="text-xs font-medium text-white/60">频谱分析</span>
                  <span class="text-[10px] opacity-50">Spectrum Analyzer</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Abstract Mode -->
          <div
            v-else-if="visualMode === 'abstract'"
            class="flex-1 flex flex-col items-center justify-center p-4 overflow-hidden"
          >
            <div class="relative w-40 h-40 flex items-center justify-center">
              <div
                class="absolute inset-0 rounded-full border border-blue-500/20 animate-[ping_3s_linear_infinite]"
              ></div>
              <div
                class="absolute inset-4 rounded-full border border-purple-500/20 animate-[ping_2s_linear_infinite]"
              ></div>
              <div
                class="absolute inset-8 rounded-full border border-pink-500/20 animate-pulse"
              ></div>
              <div class="z-10 text-3xl animate-bounce">✨</div>
            </div>
            <div class="flex flex-col items-center gap-2 mt-8 w-full max-w-[80%]">
              <div
                v-if="parsedLyrics.length > 0 && activeLyricIndex >= 0"
                class="flex flex-col items-center gap-2"
              >
                <!-- Current Lyric -->
                <div class="text-sm font-bold text-white text-center drop-shadow-md">
                  {{ parsedLyrics[activeLyricIndex]?.text }}
                </div>
                <!-- Next Lyric Preview -->
                <div
                  v-if="parsedLyrics[activeLyricIndex + 1]"
                  class="text-[11px] text-white/40 text-center line-clamp-1 italic"
                >
                  {{ parsedLyrics[activeLyricIndex + 1]?.text }}
                </div>
              </div>
              <div v-else class="flex flex-col items-center gap-1">
                <span class="text-xs font-medium text-white/60">抽象动画</span>
                <span class="text-[10px] opacity-50">Abstract Visualizations</span>
              </div>
            </div>
          </div>

          <!-- Vinyl Mode -->
          <div
            v-else-if="visualMode === 'vinyl'"
            class="flex-1 flex flex-col items-center justify-center p-4"
          >
            <div class="relative group mt-[-20px] scale-[1.1]">
              <!-- Vinyl Record -->
              <div
                class="w-56 h-56 rounded-full bg-[#111] border-[6px] border-[#222] shadow-[0_0_50px_rgba(0,0,0,0.8)] flex items-center justify-center relative overflow-hidden"
                :class="{ 'animate-[spin_10s_linear_infinite]': playerState.isPlaying }"
              >
                <!-- Grooves -->
                <div
                  class="absolute inset-0 opacity-30"
                  style="
                    background: repeating-radial-gradient(
                      circle,
                      transparent 0,
                      transparent 3px,
                      rgba(255, 255, 255, 0.05) 4px,
                      transparent 5px
                    );
                  "
                ></div>
                <!-- Center Label -->
                <div
                  class="w-20 h-20 rounded-full overflow-hidden border-4 border-[#111] z-10 shadow-inner"
                >
                  <img
                    v-if="currentTrackDetail?.coverUrl"
                    :src="getCoverUrl(currentTrackDetail)"
                    class="w-full h-full object-cover"
                  />
                  <div
                    v-else
                    class="w-full h-full bg-zinc-800 flex items-center justify-center text-white/20"
                  >
                    💿
                  </div>
                </div>
                <!-- Hole -->
                <div class="absolute w-2 h-2 bg-black rounded-full z-20 shadow-inner"></div>
              </div>

              <!-- Tonearm (Needle) -->
              <div
                class="absolute -top-6 -right-4 w-32 h-32 pointer-events-none transition-transform duration-700 ease-in-out origin-[85%_15%]"
                :style="{
                  transform: playerState.isPlaying ? 'rotate(0deg)' : 'rotate(-25deg)',
                }"
              >
                <div class="absolute top-[15%] right-[15%] w-4 h-4 bg-zinc-600 rounded-full"></div>
                <div
                  class="absolute top-[18%] right-[17%] w-1.5 h-24 bg-gradient-to-b from-zinc-500 to-zinc-700 rounded-full origin-top rotate-[25deg]"
                ></div>
                <div
                  class="absolute bottom-[15%] left-[10%] w-4 h-6 bg-zinc-800 rounded-sm rotate-[25deg]"
                ></div>
              </div>
            </div>
            <div class="flex flex-col items-center gap-2 mt-12 w-full max-w-[80%]">
              <div
                v-if="parsedLyrics.length > 0 && activeLyricIndex >= 0"
                class="flex flex-col items-center gap-2"
              >
                <!-- Current Lyric -->
                <div class="text-sm font-bold text-white text-center drop-shadow-md">
                  {{ parsedLyrics[activeLyricIndex]?.text }}
                </div>
                <!-- Next Lyric Preview -->
                <div
                  v-if="parsedLyrics[activeLyricIndex + 1]"
                  class="text-[11px] text-white/40 text-center line-clamp-1 italic"
                >
                  {{ parsedLyrics[activeLyricIndex + 1]?.text }}
                </div>
              </div>
              <div v-else class="flex flex-col items-center gap-1">
                <span class="text-xs font-medium text-white/60">封面与黑胶</span>
                <span class="text-[10px] opacity-50">Cover Art &amp; Vinyl</span>
              </div>
            </div>
          </div>

          <!-- Controls moved here to center in lyrics area -->
          <div class="absolute left-1/2 -translate-x-1/2 bottom-3 z-20 max-w-[calc(100vw-2rem)]">
            <div
              class="bg-black/40 backdrop-blur-md rounded-xl px-4 py-2 shadow-lg flex items-center gap-6 w-fit min-w-[280px] max-w-[calc(100vw-2rem)] transition-all opacity-0 group-hover:opacity-100 duration-300"
            >
              <div class="flex items-center justify-center gap-4 shrink-0">
                <button
                  @click="prevTrack"
                  class="w-7 h-7 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 transition-colors text-white/70"
                >
                  {{ ICON_PREV }}
                </button>
                <button
                  @click="togglePlay"
                  class="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors text-white scale-[1.3] transition-transform"
                >
                  {{ playerState.isPlaying ? ICON_PAUSE : ICON_PLAY }}
                </button>
                <button
                  @click="() => nextTrack()"
                  class="w-7 h-7 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 transition-colors text-white/70"
                >
                  {{ ICON_NEXT }}
                </button>
              </div>

              <div class="flex items-center gap-2 shrink-0 border-l border-white/10 pl-6">
                <span class="text-xs text-white/70">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    class="w-4 h-4"
                  >
                    <path
                      d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
                    />
                  </svg>
                </span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  :value="playerState.volume"
                  @input="onVolumeChange"
                  class="w-20 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.1);
}

.aplayer {
  background: transparent;
  border: none;
  box-shadow: none;
  color: #666;
  overflow: hidden;
  user-select: none;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.aplayer-mini:not(.aplayer-withlist) {
  justify-content: center;
}

.aplayer-body {
  display: flex;
  align-items: stretch; /* 让封面和信息区域都填满高度 */
  height: 100%;
  width: 100%;
}

.aplayer-pic {
  width: 110px;
  height: 100%;
  flex: 0 0 110px;
  background-color: transparent;
  position: relative;
  overflow: hidden;
  /* 优化三边渐变融合，减少遮挡面积，确保封面能显示全 */
  mask-image:
    linear-gradient(to right, black 85%, transparent 100%),
    linear-gradient(to bottom, transparent 0%, black 10%, black 90%, transparent 100%);
  mask-composite: intersect;
  -webkit-mask-image:
    linear-gradient(to right, black 85%, transparent 100%),
    linear-gradient(to bottom, transparent 0%, black 10%, black 90%, transparent 100%);
  -webkit-mask-composite: source-in;
}

.aplayer-pic-btn {
  position: absolute;
  inset: 0;
  border: 0;
  background-color: transparent;
  background-size: cover;
  background-position: center;
  color: #fff;
  cursor: pointer;
  opacity: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.aplayer-pic-icon {
  font-size: 18px;
  line-height: 1;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.35);
  transition: all 0.3s ease;
  transform: scale(1.5);
}

.aplayer-pic-icon.is-playing {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 24px;
  height: 24px;
  font-size: 14px;
}

.aplayer-info {
  flex: 1;
  min-width: 0;
  padding: 15px 0 0 12px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  z-index: 1;
  position: relative;
}

/* .aplayer-music removed as per request, styles integrated into children or info container */

.aplayer-music-text-wrap {
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
  position: relative;
}

.aplayer-title {
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  display: inline-block;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  padding-right: 15px;
}

.aplayer-author {
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  display: inline-block;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  padding-right: 15px;
}

.aplayer-marquee {
  display: inline-block;
  padding-left: 0;
  animation: aplayer-marquee 10s linear infinite;
}

@keyframes aplayer-marquee {
  0% {
    transform: translateX(0);
  }
  10% {
    transform: translateX(0);
  }
  90% {
    transform: translateX(-50%);
  }
  100% {
    transform: translateX(-50%);
  }
}

.aplayer-time-main {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  width: 100%;
  margin-top: 6px;
  gap: 4px; /* 统一所有按钮之间的间距 */
  padding-right: 15px;
  box-sizing: border-box;
}

.aplayer-controls,
.aplayer-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.aplayer-bar-container {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 4px;
  padding-right: 15px;
  box-sizing: border-box;
}

.aplayer-bar-wrap {
  position: relative;
  height: 12px;
  cursor: pointer;
  flex: 1; /* 让进度条占据剩余空间 */
  min-width: 0;
}

.aplayer-bar {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  height: 3px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}

.aplayer-loaded {
  position: absolute;
  left: 0;
  top: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 2px;
}

.aplayer-played {
  position: absolute;
  left: 0;
  top: 0;
  height: 3px;
  background: #60a5fa;
  border-radius: 2px;
}

.aplayer-thumb {
  position: absolute;
  right: -5px;
  top: -4px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #60a5fa;
  box-sizing: border-box;
  box-shadow: 0 0 5px rgba(0, 0, 0, 0.3);
}

.aplayer-seek {
  position: absolute;
  left: 0;
  top: -5px;
  width: 100%;
  height: 12px;
  opacity: 0;
  cursor: pointer;
}

.aplayer-time-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}

.aplayer-chip {
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  height: 22px;
  padding: 0 8px;
  border-radius: 11px;
  font-size: 12px;
  line-height: 22px;
  display: inline-flex;
  align-items: center;
  backdrop-filter: blur(4px);
}

.aplayer-chip:hover {
  background: rgba(255, 255, 255, 0.2);
}

.aplayer-chip.is-active {
  background: #60a5fa;
  border-color: #60a5fa;
  color: #fff;
}

.aplayer-ptime {
  font-variant-numeric: tabular-nums;
  font-size: 16.5px;
  color: rgba(255, 255, 255, 0.8);
  min-width: 45px;
  flex: 0 0 auto;
}

.aplayer-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  margin-left: auto;
}

.aplayer-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.aplayer-btn {
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  width: 33px;
  height: 33px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.2s;
  letter-spacing: 0.5px;
}

.aplayer-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.aplayer-btn-play {
  width: 26px;
}

.aplayer-volume {
  position: relative;
}

.aplayer-volume-panel {
  position: absolute;
  right: 0;
  bottom: 35px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  z-index: 5;
  width: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.aplayer-volume-slider {
  appearance: none;
  -webkit-appearance: none;
  width: 100% !important;
  height: 4px !important;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.aplayer-volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  cursor: pointer;
  border: 2px solid #60a5fa;
  box-shadow: 0 0 5px rgba(0, 0, 0, 0.3);
}

.aplayer-volume-panel input[type="range"] {
  width: 80px;
  accent-color: #60a5fa;
}

.aplayer-list {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.aplayer-list-top {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.1);
}

.aplayer-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.aplayer-tab {
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  width: 30px;
  height: 24px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  transition: all 0.2s;
}

.aplayer-tab:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.aplayer-tab.is-active {
  background: #60a5fa;
  border-color: #60a5fa;
  color: #fff;
}

.aplayer-list-search {
  flex: 1;
  min-width: 0;
  height: 26px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 0 8px;
  font-size: 12px;
  outline: none;
  color: #fff;
}

.aplayer-list-search::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.aplayer-list-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.aplayer-list-state {
  padding: 10px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.aplayer-list-state.is-error {
  color: #ef4444;
}

.aplayer-list-ol {
  list-style: none;
  margin: 0;
  padding: 0;
}

.aplayer-list-li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  cursor: pointer;
  transition: all 0.2s;
}

.aplayer-list-li:hover {
  background: rgba(255, 255, 255, 0.05);
}

.aplayer-list-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.9);
}

.aplayer-list-author {
  flex: 0 0 auto;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.aplayer.is-tall .aplayer-body {
  min-height: 72px;
}
</style>
