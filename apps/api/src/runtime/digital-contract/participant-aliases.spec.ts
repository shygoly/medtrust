import { participantMatches } from "./participant-aliases";

describe("participant aliases", () => {
  it("keeps the research institute alias", () => {
    expect(participantMatches("p-meddata", "医研数据研究院")).toBe(true);
  });

  it("does not alias the pharma consumer to the research institute", () => {
    expect(participantMatches("pharma-demo", "p-meddata")).toBe(false);
    expect(participantMatches("p-meddata", "pharma-demo")).toBe(false);
  });
});
