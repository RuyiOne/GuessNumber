import hashlib
import json
from pathlib import Path

from gn_rl.belief import Belief
from gn_rl.codes import all_codes, neighbours_at_distance_two
from gn_rl.scoring import score

ROOT = Path(__file__).resolve().parents[2]
VECTOR = json.loads((ROOT / "tests" / "vectors" / "parity.json").read_text(encoding="utf-8"))


def _sha256(codes: list[str]) -> str:
    return hashlib.sha256("\n".join(codes).encode("utf-8")).hexdigest()


def test_code_lists_match_the_engine():
    for name, expected in VECTOR["rulesets"].items():
        codes = all_codes(name)
        assert len(codes) == expected["count"]
        assert codes[0] == expected["first"]
        assert codes[-1] == expected["last"]
        assert _sha256(codes) == expected["sha256"]


def test_known_scores_match_the_engine():
    for row in VECTOR["scores"]:
        dead, wounded, points = score(row["guess"], row["secret"])
        assert (dead, wounded, points) == (row["dead"], row["wounded"], row["points"])


def test_candidate_filter_matches_the_engine_vector():
    codes = all_codes("classic4")
    belief = Belief(codes, "classic4")
    for step in VECTOR["filter"]["steps"]:
        belief.observe(step["guess"], step["dead"], step["wounded"], turn=1)
    remaining = belief.candidates()
    assert len(remaining) == VECTOR["filter"]["remainingCount"]
    assert _sha256(remaining) == VECTOR["filter"]["remainingSha256"]


def test_distance_two_neighbour_changes_exactly_two_positions():
    neighbours = neighbours_at_distance_two("1234", "classic4")
    assert "1243" in neighbours
    assert "1234" not in neighbours
    assert "1235" not in neighbours
    assert all(sum(left != right for left, right in zip(code, "1234")) == 2 for code in neighbours)
