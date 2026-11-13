import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameRoomSelector } from "@/bro/lobby/GameRoomSelector";
import { findGame } from "@/bro/lobby/catalog";

afterEach(cleanup);

describe("牌桌场次选择", () => {
  const game = findGame("holdem")!;

  it("先显示三个场次、门槛和当前积分，不在打开时直接扣费", () => {
    const onSelect = vi.fn();
    render(
      <GameRoomSelector game={game} balance={350} onSelect={onSelect} />,
    );
    expect(screen.getByText("350")).toBeInTheDocument();
    for (const room of game.rooms!) {
      expect(screen.getByText(room.name)).toBeInTheDocument();
      expect(screen.getByText(String(room.price))).toBeInTheDocument();
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("只能选择余额够用的场次", () => {
    const onSelect = vi.fn();
    render(
      <GameRoomSelector game={game} balance={350} onSelect={onSelect} />,
    );
    const starter = screen.getByRole("button", {
      name: "进入车库桌，100 积分",
    });
    const high = screen.getByRole("button", {
      name: "Mainframe 桌，需要 800 积分",
    });
    expect(starter).toBeEnabled();
    expect(high).toBeDisabled();
    fireEvent.click(starter);
    expect(onSelect).toHaveBeenCalledWith(game.rooms![0]);
  });
});

