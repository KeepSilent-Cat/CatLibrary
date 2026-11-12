import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Disc3,
  FolderTree,
  ListMusic,
  Music,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export interface MusicTrack {
  name: string;
  path: string;
  relativePath: string;
  bucket: string;
  format: string;
}

/** 音频扩展名（与后端 AUDIO_EXTENSIONS 保持一致） */
export const AUDIO_FILE_RE = /\.(mp3|flac|wav|m4a|aac|ogg|opus|wma)$/i;

export interface MusicPlayerProps {
  compact?: boolean;
  tracks: MusicTrack[];
  coverImage?: string;
  title: string;
  subtitle?: string;
  summary: string;
  sourceCount: number;
  loadingTracks?: boolean;
}

interface AggregatedSong {
  key: string;
  title: string;
  variants: MusicTrack[];
  order: number;
}

const FORMAT_PRIORITY = ["MP3", "FLAC", "M4A", "AAC", "OGG", "OPUS", "WMA", "WAV"] as const;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function stripTrackPrefix(name: string): string {
  return name.replace(/^\s*\d+\s*[.．、,\-]?\s*/u, "").trim();
}

function normalizeSongKey(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function formatPriority(format: string): number {
  const index = FORMAT_PRIORITY.indexOf(format as (typeof FORMAT_PRIORITY)[number]);
  return index === -1 ? FORMAT_PRIORITY.length : index;
}

function compareTrackFormats(left: MusicTrack, right: MusicTrack): number {
  const priorityDiff = formatPriority(left.format) - formatPriority(right.format);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  return left.relativePath.localeCompare(right.relativePath, "zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

function pickPreferredVariant(variants: MusicTrack[]): MusicTrack {
  return [...variants].sort(compareTrackFormats)[0];
}

export default function MusicPlayer({
  compact = false,
  tracks,
  coverImage,
  title,
  subtitle,
  summary,
  sourceCount,
  loadingTracks = false,
}: MusicPlayerProps) {
  useEffect(()=>{const audio=audioRef.current;return()=>audio?.pause();},[]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [songIndex, setSongIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [trackDurations, setTrackDurations] = useState<Record<string, number>>({});
  const [selectedVariantBySong, setSelectedVariantBySong] = useState<Record<string, string>>({});

  const songs = useMemo(() => {
    const grouped = new Map<string, AggregatedSong>();

    tracks.forEach((track, index) => {
      const normalizedTitle = stripTrackPrefix(track.name);
      const key = normalizeSongKey(normalizedTitle);
      const existing = grouped.get(key);
      if (existing) {
        existing.variants.push(track);
        return;
      }
      grouped.set(key, {
        key,
        title: normalizedTitle,
        variants: [track],
        order: index,
      });
    });

    return [...grouped.values()]
      .sort((left, right) => left.order - right.order)
      .map((song) => ({
        ...song,
        variants: [...song.variants].sort(compareTrackFormats),
      }));
  }, [tracks]);

  const formatCount = useMemo(
    () => new Set(tracks.map((track) => track.format)).size,
    [tracks],
  );

  useEffect(() => {
    setSelectedVariantBySong((currentSelections) => {
      const nextSelections: Record<string, string> = {};
      for (const song of songs) {
        const preferred = pickPreferredVariant(song.variants);
        const currentPath = currentSelections[song.key];
        const matched = song.variants.find((variant) => variant.path === currentPath);
        nextSelections[song.key] = matched?.path ?? preferred.path;
      }
      return nextSelections;
    });
  }, [songs]);

  useEffect(() => {
    setSongIndex((value) => (songs.length === 0 ? 0 : Math.min(value, songs.length - 1)));
  }, [songs.length]);

  const currentSong = songs[songIndex];
  const current =
    currentSong?.variants.find(
      (variant) => variant.path === selectedVariantBySong[currentSong.key],
    ) ?? (currentSong ? pickPreferredVariant(currentSong.variants) : undefined);

  useEffect(() => {
    setTrackDurations((currentDurations) =>
      Object.fromEntries(
        Object.entries(currentDurations).filter(([path]) =>
          tracks.some((track) => track.path === path),
        ),
      ),
    );
  }, [tracks]);

  // 换曲：重新加载音源
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current) {
      return;
    }
    audio.src = convertFileSrc(current.path);
    audio.load();
    setCurrentTime(0);
    setDuration(0);
    if (playing) {
      void audio.play().catch(() => setPlaying(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songIndex, current?.path]);

  // 播放 / 暂停
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (playing) {
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, [playing]);

  // 音量 / 静音
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = muted ? 0 : volume;
    }
  }, [volume, muted]);

  useEffect(() => {
    let cancelled = false;

    const pending = tracks.filter((track) => trackDurations[track.path] === undefined);
    if (pending.length === 0) {
      return;
    }

    const loadDurations = async () => {
      for (const track of pending) {
        await new Promise<void>((resolve) => {
          const probe = document.createElement("audio");
          const cleanup = () => {
            probe.removeAttribute("src");
            probe.load();
          };

          probe.preload = "metadata";
          probe.src = convertFileSrc(track.path);
          probe.onloadedmetadata = () => {
            if (!cancelled) {
              setTrackDurations((currentDurations) => ({
                ...currentDurations,
                [track.path]: Number.isFinite(probe.duration) ? probe.duration : 0,
              }));
            }
            cleanup();
            resolve();
          };
          probe.onerror = () => {
            cleanup();
            resolve();
          };
        });

        if (cancelled) {
          break;
        }
      }
    };

    void loadDurations();

    return () => {
      cancelled = true;
    };
  }, [trackDurations, tracks]);

  const togglePlay = () => {
    if (!current) {
      return;
    }
    setPlaying((value) => !value);
  };

  const playTrack = (targetIndex: number) => {
    setSongIndex(targetIndex);
    setPlaying(true);
  };

  const playPrev = () => {
    if (songs.length === 0) {
      return;
    }
    setSongIndex((value) => (value - 1 + songs.length) % songs.length);
    setPlaying(true);
  };

  const playNext = () => {
    if (songs.length === 0) {
      return;
    }
    setSongIndex((value) => (value + 1) % songs.length);
    setPlaying(true);
  };

  const switchVariant = (targetSongIndex: number, targetPath: string) => {
    const song = songs[targetSongIndex];
    if (!song) {
      return;
    }
    setSelectedVariantBySong((currentSelections) => ({
      ...currentSelections,
      [song.key]: targetPath,
    }));
    setSongIndex(targetSongIndex);
    setPlaying(true);
  };

  const seek = (ratio: number) => {
    const audio = audioRef.current;
    if (!audio || !duration) {
      return;
    }
    audio.currentTime = ratio * duration;
    setCurrentTime(audio.currentTime);
  };

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <div className={`flex h-full flex-col overflow-hidden ${compact?"":"min-h-[420px] rounded-[30px] bg-[radial-gradient(circle_at_top_left,rgba(120,160,220,0.18),rgba(20,28,44,0.14)_26%,rgba(6,10,20,0.88)_72%)]"}`}>
      <audio
        ref={audioRef}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onEnded={playNext}
      />

      {compact?<div className="px-5 pb-4 pt-4"><div className="flex items-center gap-3"><div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/12 bg-white/8">{coverImage?<img src={coverImage} alt="" className="h-full w-full object-cover"/>:<Disc3 size={24} className="text-sky-100/70"/>}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-white/90">{currentSong?.title??title}</p><p className="mt-1 truncate text-[11px] text-white/45">{title}</p></div><div className="flex shrink-0 items-center gap-1"><button aria-label="上一首" onClick={playPrev} className="rounded-full p-2 text-white/55 hover:text-white"><SkipBack size={15}/></button><button aria-label={playing?'暂停':'播放'} onClick={togglePlay} className="grid h-9 w-9 place-items-center rounded-full border border-sky-100/25 bg-sky-200/15 text-sky-50 hover:bg-sky-200/25">{playing?<Pause size={16}/>:<Play size={16}/>}</button><button aria-label="下一首" onClick={playNext} className="rounded-full p-2 text-white/55 hover:text-white"><SkipForward size={15}/></button></div></div><div className="mt-4 flex items-center gap-3 text-[10px] tabular-nums text-white/40"><span>{formatTime(currentTime)}</span><input aria-label="音乐播放进度" type="range" min="0" max="1" step="0.001" value={progress} onChange={e=>seek(Number(e.target.value))} className="h-1 min-w-0 flex-1 accent-sky-200"/><span>{formatTime(duration)}</span></div></div>:<>
      <div className="grid min-h-0 flex-1 gap-10 p-8 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col">
          <div className="relative aspect-square overflow-hidden rounded-[30px] bg-white/6 shadow-[0_28px_90px_rgba(0,0,0,0.34)]">
            {coverImage ? (
              <img src={coverImage} alt={title} className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white/34">
                <Disc3 className="h-20 w-20" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
          </div>

          <div className="mt-7">
            <p className="text-xs uppercase tracking-[0.26em] text-white/46">Album</p>
            <h2 className="mt-2 text-[2rem] font-semibold leading-tight text-white">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-white/58">{subtitle}</p> : null}
            {summary ? <p className="mt-4 text-sm leading-7 text-white/76">{summary}</p> : null}
          </div>

          <div className="mt-5 flex flex-wrap gap-2.5 text-xs text-white/78">
            <span className="rounded-full bg-white/10 px-3 py-1.5">
              {songs.length || sourceCount} 首曲目
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1.5">
              {formatCount || 0} 种格式
            </span>
          </div>

          <div className="mt-8">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-white/40">
              <FolderTree className="h-3.5 w-3.5" />
              当前播放
            </div>
            {current ? (
              <>
                <p className="mt-3 truncate text-lg font-medium text-white">{currentSong?.title ?? current.name}</p>
                <p className="mt-1 text-xs text-white/50">
                  {current.format} · {songIndex + 1}/{songs.length} · {current.relativePath}
                </p>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/36">{current.bucket}</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-white/42">还没有可播放的曲目</p>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-white/42">Track List</p>
              <p className="mt-2 text-sm text-white/66">
                同名歌曲合并为一行，右侧可切换 MP3 / WAV 等不同格式版本
              </p>
            </div>
            <div className="rounded-full bg-white/8 px-3 py-1.5 text-xs text-white/56">
              {songs.length || sourceCount} 首 / {formatCount || 0} 种格式
            </div>
          </div>

          {loadingTracks ? (
            <div className="flex flex-1 items-center justify-center gap-3 text-white/50">
              <Music className="h-7 w-7" />
              <span className="text-sm">正在读取专辑曲目...</span>
            </div>
          ) : songs.length === 0 ? (
            <div className="flex flex-1 items-center justify-center gap-3 text-white/50">
              <Music className="h-7 w-7" />
              <span className="text-sm">这个条目下还没有音频文件</span>
            </div>
          ) : (
            <div className="mt-6 min-h-0 flex-1 overflow-y-auto pr-2">
              {songs.map((song, currentSongIndex) => {
                const active = currentSongIndex === songIndex;
                const selectedPath = selectedVariantBySong[song.key] ?? pickPreferredVariant(song.variants).path;
                const selectedVariant =
                  song.variants.find((variant) => variant.path === selectedPath) ??
                  pickPreferredVariant(song.variants);
                const currentDuration = trackDurations[selectedVariant.path];
                return (
                  <button
                    key={song.key}
                    type="button"
                    onClick={() => playTrack(currentSongIndex)}
                    className={`mb-1.5 flex w-full items-center gap-4 rounded-[20px] px-3 py-3 text-left transition ${
                      active
                        ? "bg-white/12 text-white"
                        : "text-white/70 hover:bg-white/7 hover:text-white"
                    }`}
                  >
                    <span className="w-8 shrink-0 text-right text-sm tabular-nums text-white/34">
                      {currentSongIndex + 1}
                    </span>
                    <span className="shrink-0 text-white/42">
                      {active ? (
                        playing ? (
                          <Pause className="h-3.5 w-3.5 text-sky-200" />
                        ) : (
                          <Play className="h-3.5 w-3.5 text-sky-200" />
                        )
                      ) : (
                        <ListMusic className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{song.title}</p>
                          <p className="mt-1 truncate text-[11px] text-white/38">
                            {selectedVariant.relativePath}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs tabular-nums text-white/42">
                          {currentDuration !== undefined ? formatTime(currentDuration) : "--:--"}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {song.variants.map((variant) => {
                          const selected = variant.path === selectedPath;
                          return (
                            <span
                              key={variant.path}
                              role="button"
                              tabIndex={0}
                              onClick={(event) => {
                                event.stopPropagation();
                                switchVariant(currentSongIndex, variant.path);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  switchVariant(currentSongIndex, variant.path);
                                }
                              }}
                              className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] transition ${
                                selected
                                  ? "bg-sky-300/18 text-sky-100"
                                  : "bg-white/6 text-white/42 hover:bg-white/12 hover:text-white/76"
                              }`}
                            >
                              {variant.format}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-6 border-t border-white/8 pt-5">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{currentSong?.title ?? "未选择曲目"}</p>
                <p className="mt-1 truncate text-xs text-white/46">
                  {current ? `${current.format} · ${current.relativePath}` : "点击右侧列表开始播放"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMuted((value) => !value)}
                  title={muted ? "取消静音" : "静音"}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/16"
                >
                  {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={(event) => {
                    setVolume(Number(event.target.value));
                    setMuted(false);
                  }}
                  className="w-24 accent-sky-300"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={playPrev}
                title="上一首"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/16"
              >
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={togglePlay}
                title={playing ? "暂停" : "播放"}
                className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-sky-300/22 text-sky-50 transition hover:bg-sky-300/32"
              >
                {playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
              </button>
              <button
                type="button"
                onClick={playNext}
                title="下一首"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/16"
              >
                <SkipForward className="h-4 w-4" />
              </button>
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-white/60">
                {formatTime(currentTime)}
              </span>
              <div
                role="slider"
                aria-label="播放进度"
                tabIndex={0}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  seek((event.clientX - rect.left) / rect.width);
                }}
                className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-white/14"
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-sky-300"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <span className="w-12 shrink-0 text-xs tabular-nums text-white/60">{formatTime(duration)}</span>
            </div>
          </div>
        </div>
      </div>
      </>}
    </div>
  );
}
