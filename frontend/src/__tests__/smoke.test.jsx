import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

function SmokeComponent() {
  return <span>MAPGEO frontend prêt</span>;
}

describe("frontend smoke", () => {
  it("rend un composant React minimal", () => {
    render(<SmokeComponent />);
    expect(screen.getByText("MAPGEO frontend prêt")).toBeInTheDocument();
  });
});
