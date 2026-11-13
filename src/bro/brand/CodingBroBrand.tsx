import { cn } from "@/lib/utils";
import "./brand.css";

interface CodingBroBrandProps {
  readonly compact?: boolean;
  readonly active?: boolean;
  readonly className?: string;
}

/**
 * Coding Bro 的产品签名。
 *
 * `>_` 不是一枚随手放上的终端图标：它是贯穿开发工具、游戏大厅与 Reset
 * 商店的品牌母题——先发出指令，再得到反馈。亮色像嵌进陶瓷机身的金属铭牌，
 * 暗色则像终端状态灯；轮廓和字标不随主题改变，因此仍是同一个品牌。
 */
export function CodingBroBrand({
  compact = false,
  active = false,
  className,
}: CodingBroBrandProps) {
  return (
    <span
      className={cn(
        "bro-brand",
        compact && "bro-brand--compact",
        active && "is-active",
        className,
      )}
    >
      <span className="bro-brand__mark" aria-hidden="true">
        <span className="bro-brand__prompt">&gt;</span>
        <span className="bro-brand__cursor" />
      </span>
      {!compact && (
        <span className="bro-brand__copy">
          <span className="bro-brand__name">Coding Bro</span>
          <span className="bro-brand__line">BUILD / PLAY / RESET</span>
        </span>
      )}
      <span className="sr-only">Coding Bro</span>
    </span>
  );
}
