/**
 * 对局会话。
 *
 * 持有服务端状态与当前渲染器，负责三件事：接收快照、切换渲染器、
 * 上报意图。
 *
 * 存在的理由是「主题切换不能重建对局」这一条约束：如果状态由渲染器
 * 持有，换渲染器就等于丢状态，用户切个主题会掉线。状态放在会话里、
 * 渲染器只读，切换才是安全的——换完立刻用现有状态重绘即可。
 */

import type { GameRenderer, GameState, InputIntent } from "./types";
import { shouldAccept } from "./types";

export class GameSession<T> {
  private state: GameState<T> | null = null;
  private renderer: GameRenderer<T> | null = null;

  constructor(private readonly sendIntent: (intent: InputIntent) => void) {}

  /**
   * 接收服务端快照。
   *
   * 乱序到达的旧快照被丢弃，返回 `false`。调用方无需自行判序。
   */
  applySnapshot(next: GameState<T>): boolean {
    if (!shouldAccept(this.state, next)) return false;
    this.state = next;
    this.renderer?.render(next);
    return true;
  }

  /**
   * 挂载或替换渲染器。
   *
   * 主题切换走这里。状态不受影响——新渲染器立即以当前状态重绘，
   * 用户看到的是同一局棋换了副皮肤，而不是重新开局。
   */
  attachRenderer(renderer: GameRenderer<T>, container: HTMLElement): void {
    this.renderer?.unmount();
    this.renderer = renderer;
    renderer.mount(container);
    renderer.onIntent((intent) => this.sendIntent(intent));
    if (this.state) renderer.render(this.state);
  }

  /** 当前状态。仅供只读用途，调用方不得修改。 */
  currentState(): GameState<T> | null {
    return this.state;
  }

  /** 卸载渲染器，保留状态。用于临时离开对局界面（如查看积分）后返回。 */
  detachRenderer(): void {
    this.renderer?.unmount();
    this.renderer = null;
  }

  /** 结束会话，状态与渲染器一并释放。 */
  dispose(): void {
    this.detachRenderer();
    this.state = null;
  }
}
