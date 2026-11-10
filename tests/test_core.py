"""Chạy:  python -m unittest discover -s tests -v"""
import sys
import unittest
from itertools import combinations
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nqueens_solver.core import (  # noqa: E402
    Board,
    ConflictState,
    ConstraintDiscoverer,
    MinConflictsSolver,
    NQueensCNF,
)

try:
    import pysat  # noqa: F401

    HAS_PYSAT = True
except ImportError:
    HAS_PYSAT = False


class BoardTests(unittest.TestCase):
    def test_valid_solution_n4(self):
        self.assertTrue(Board.from_columns([1, 3, 0, 2]).is_solution())

    def test_detects_attacks(self):
        b = Board.from_columns([0, 1, 2, 3])  # cùng đường chéo chính
        self.assertEqual(b.attacking_pairs(), 6)
        self.assertFalse(b.is_solution())

    def test_decode_model(self):
        # N=4: biến v = r*4 + c + 1
        model = [-1, 2, -3, -4, -5, -6, -7, 8, 9, -10, -11, -12, -13, -14, 15, -16]
        self.assertEqual(Board.from_model(4, model).queens, {(0, 1), (1, 3), (2, 0), (3, 2)})


class CNFTests(unittest.TestCase):
    def test_clause_count_matches_closed_form(self):
        for n in range(1, 13):
            self.assertEqual(NQueensCNF(n).num_clauses, NQueensCNF.expected_clause_count(n), n)

    def test_constraints_equal_brute_force_attack_relation(self):
        for n in range(2, 8):
            cells = [(r, c) for r in range(n) for c in range(n)]
            expected = {frozenset(p) for p in combinations(cells, 2) if ConstraintDiscoverer.attacks(*p)}
            cnf = NQueensCNF(n)
            produced = set()
            for g in cnf.groups[1:]:  # bỏ nhóm "ít nhất một"
                for a, b in g.clauses:
                    self.assertTrue(a < 0 and b < 0)
                    produced.add(frozenset((cnf.vars.cell(-a), cnf.vars.cell(-b))))
            self.assertEqual(produced, expected, n)

    def test_each_attacking_pair_appears_once(self):
        cnf = NQueensCNF(6)
        seen = [frozenset(c) for g in cnf.groups[1:] for c in g.clauses]
        self.assertEqual(len(seen), len(set(seen)))

    def test_variable_mapping_roundtrip(self):
        cnf = NQueensCNF(5)
        for r in range(5):
            for c in range(5):
                self.assertEqual(cnf.vars.cell(cnf.vars.var(r, c)), (r, c))


class ConflictStateTests(unittest.TestCase):
    def test_incremental_total_matches_board(self):
        cols = [2, 0, 3, 3, 1, 5, 4, 4]
        state = ConflictState(len(cols))
        for r, c in enumerate(cols):
            state.place(r, c)
        self.assertEqual(state.total, Board.from_columns(cols).attacking_pairs())
        state.remove(3)
        state.place(3, 6)
        cols[3] = 6
        self.assertEqual(state.total, Board.from_columns(cols).attacking_pairs())


class MinConflictsTests(unittest.TestCase):
    def test_both_variants_return_valid_solutions(self):
        for factory in (MinConflictsSolver.standard, MinConflictsSolver.heuristic):
            for n in (4, 5, 8, 16, 50):
                res = factory(50_000).solve(n, seed=7)
                self.assertTrue(res.solved, (res.algorithm, n))
                self.assertTrue(res.board.is_solution(), (res.algorithm, n))

    def test_reproducible_with_seed(self):
        a = MinConflictsSolver.heuristic().solve(30, seed=3)
        b = MinConflictsSolver.heuristic().solve(30, seed=3)
        self.assertEqual((a.steps, a.board.queens), (b.steps, b.board.queens))

    def test_recorded_events_replay_to_final_board(self):
        res = MinConflictsSolver.standard().solve(20, seed=5, record=True)
        cols = list(res.init_cols)
        for e in res.events:
            if e[0] == "move":
                cols[e[1]] = e[3]
            else:
                cols = list(e[1])
        self.assertEqual(cols, res.board.to_columns())

    def test_n2_n3_rejected(self):
        with self.assertRaises(ValueError):
            MinConflictsSolver.standard().solve(3)


@unittest.skipUnless(HAS_PYSAT, "cần cài python-sat")
class SATTests(unittest.TestCase):
    def test_glucose3_solutions_are_valid(self):
        from nqueens_solver.core import GlucoseQueensSolver

        solver = GlucoseQueensSolver()
        for n in (4, 5, 6, 8, 10, 12):
            res = solver.solve(n)
            self.assertTrue(res.satisfiable and res.valid, n)
            self.assertEqual(res.num_clauses, NQueensCNF.expected_clause_count(n))

    def test_unsat_for_n2_n3(self):
        from nqueens_solver.core import GlucoseQueensSolver

        for n in (2, 3):
            self.assertFalse(GlucoseQueensSolver().solve(n).satisfiable)


if __name__ == "__main__":
    unittest.main()
