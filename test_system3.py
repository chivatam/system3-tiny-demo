"""Run with: python3 -m unittest -v"""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import system3


class System3Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.memory = self.root / "memory.json"
        self.notes = self.root / "notes.json"

    def cli(self, text, destination=None):
        command = [sys.executable, str(Path(system3.__file__).resolve()), "run",
                   "--state", str(self.memory), "--text", text, "--json"]
        if destination is not None:
            command += ["--destination", destination]
        result = subprocess.run(command, capture_output=True, text=True, check=True)
        return json.loads(result.stdout)

    def test_failure_schema_read_and_verified_success(self):
        report = system3.Agent(self.memory).run(
            system3.NotesAPI("collection", self.notes), "First note")
        self.assertTrue(report["success"])
        self.assertEqual([e["action"]["tool"] for e in report["trace"]],
                         ["create_note", "read_schema", "create_note"])
        self.assertEqual([e["observation"]["ok"] for e in report["trace"]],
                         [False, True, True])
        self.assertEqual(report["trace"][0]["observation"]["error"], "invalid_payload")
        self.assertEqual(report["skill"], "collection")
        self.assertEqual(report["self"],
                         {"capability": "ready", "successes": 1, "failures": 1})
        self.assertEqual(json.loads(self.notes.read_text()),
                         [{"id": 1, "text": "First note", "destination": "inbox"}])

    def test_process_restarts_reuse_skill_but_never_stale_payload(self):
        first = self.cli("First request", "inbox")
        second = self.cli("Changed request", "research")
        third = self.cli("Newest request")
        self.assertEqual([r["tool_calls"] for r in (first, second, third)], [3, 1, 1])
        self.assertEqual([r["retrieved_skill"] for r in (first, second, third)],
                         [False, True, True])
        self.assertEqual({r["identity"] for r in (first, second, third)},
                         {first["identity"]})
        self.assertEqual([r["skill"] for r in (first, second, third)],
                         ["collection"] * 3)
        self.assertEqual(json.loads(self.notes.read_text()), [
            {"id": 1, "text": "First request", "destination": "inbox"},
            {"id": 2, "text": "Changed request", "destination": "research"},
            {"id": 3, "text": "Newest request", "destination": "research"},
        ])

    def test_api_drift_invalidates_mapping_before_relearning(self):
        first = system3.Agent(self.memory).run(
            system3.NotesAPI("collection", self.notes), "Before drift")
        api = system3.NotesAPI("workspace", self.notes)
        failed = system3.Agent(self.memory).run(api, "After drift", max_steps=1)
        self.assertFalse(failed["success"])
        self.assertTrue(failed["retrieved_skill"])
        self.assertIsNone(json.loads(self.memory.read_text())["skill"])
        self.assertEqual(len(json.loads(self.notes.read_text())), 1)
        recovered = system3.Agent(self.memory).run(api, "After drift")
        self.assertTrue(recovered["success"])
        self.assertEqual(recovered["identity"], first["identity"])
        self.assertEqual(recovered["skill"], "workspace")
        self.assertEqual([e["action"]["tool"] for e in recovered["trace"]],
                         ["read_schema", "create_note"])
        self.assertEqual(len(json.loads(self.notes.read_text())), 2)

    def test_guardian_and_storage_guards_prevent_data_loss(self):
        api = system3.NotesAPI("folder", self.notes)
        api.execute({"tool": "create_note", "args": {"text": "Existing", "folder": "inbox"}})
        frontier = system3.plan("New note", "research", "folder", "untried")
        for args in ({"text": "Replaced note", "folder": "research"},
                     {"text": "New note", "folder": "elsewhere"}):
            frontier.append({"goal": "alter the payload", "external": 1.0,
                             "intrinsic": 1.0,
                             "action": {"tool": "create_note", "args": args}})
        with patch.object(system3, "plan", return_value=frontier), \
                patch.object(api, "execute", wraps=api.execute) as execute:
            report = system3.Agent(self.memory).run(api, "New note", "research")
        self.assertTrue(report["success"])
        execute.assert_called_once_with(
            {"tool": "create_note", "args": {"text": "New note", "folder": "research"}})
        self.assertEqual(sum(c["rejected"] is not None for c in frontier), 3)
        self.assertEqual(json.loads(self.notes.read_text()), [
            {"id": 1, "text": "Existing", "destination": "inbox"},
            {"id": 2, "text": "New note", "destination": "research"},
        ])
        for collision in (self.root / "fresh" / "notes.json", self.notes):
            with self.subTest(state=collision):
                before = collision.read_bytes() if collision.exists() else None
                result = subprocess.run(
                    [sys.executable, str(Path(system3.__file__).resolve()), "run",
                     "--state", str(collision), "--text", "Never store", "--json"],
                    capture_output=True, text=True)
                self.assertEqual(result.returncode, 1)
                self.assertNotIn("Traceback", result.stderr)
                after = collision.read_bytes() if collision.exists() else None
                self.assertEqual(after, before)

    def test_external_only_weighting_fails_within_the_step_budget(self):
        api = system3.NotesAPI("collection", self.notes)
        external_only = system3.Agent(self.memory, beta=1).run(api, "A note", max_steps=4)
        self.assertFalse(external_only["success"])
        self.assertEqual(external_only["tool_calls"], 4)
        self.assertEqual([e["action"]["tool"] for e in external_only["trace"]],
                         ["create_note"] * 4)
        self.assertEqual(external_only["self"]["failures"], 4)
        self.assertIsNone(external_only["skill"])
        self.assertFalse(self.notes.exists())
        hybrid = system3.Agent(self.root / "hybrid.json", beta=0.7).run(api, "A note")
        self.assertTrue(hybrid["success"])
        self.assertEqual(hybrid["tool_calls"], 3)
        self.assertEqual(hybrid["trace"][1]["action"]["tool"], "read_schema")


if __name__ == "__main__":
    unittest.main()
