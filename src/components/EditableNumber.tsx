import { useEffect, useRef, useState } from "react";

interface EditableNumberProps {
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
  className?: string;
}

/**
 * 可点击输入的数字：平时显示数值，点击变成输入框，回车/失焦提交（自动钳制到 [min, max]），Esc 取消。
 * 用于卡片宽高等滑块旁的数值，支持输入任意整数（不受滑块步进限制）。
 */
export default function EditableNumber({ value, min, max, suffix = "", onChange, className }: EditableNumberProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const parsed = Number.parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      return;
    }
    onChange(Math.min(max, Math.max(min, parsed)));
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={draft}
        min={min}
        max={max}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
          } else if (event.key === "Escape") {
            setEditing(false);
          }
        }}
        className="w-16 rounded-md border border-sky-300/50 bg-black/35 px-1.5 py-0.5 text-center text-xs tabular-nums text-white outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      title="点击输入数值"
      onClick={() => {
        setDraft(String(value));
        setEditing(true);
      }}
      className={
        className ??
        "w-14 rounded-md border border-white/12 bg-white/6 px-1.5 py-0.5 text-center text-xs tabular-nums text-white/88 transition hover:border-sky-300/40"
      }
    >
      {value}
      {suffix}
    </button>
  );
}
