"""Tests for ThinkingExtractor incremental JSON parsing."""

from __future__ import annotations

import json

from anima_server.services.agent.streaming_utils import ThinkingExtractor


class TestExtractThinkingFromCompleteJSON:
    """Full JSON string processed in one call."""

    def test_extract_thinking_from_complete_json(self) -> None:
        ext = ThinkingExtractor()
        full = json.dumps({"thinking": "I should greet the user", "message": "Hello!"})
        main_delta, thinking_delta = ext.process_fragment(full)

        assert thinking_delta == "I should greet the user"
        assert ext.thinking == "I should greet the user"

        # main_json should be valid JSON without the thinking key.
        main = json.loads(ext.main_json)
        assert main == {"message": "Hello!"}
        assert "thinking" not in main


class TestExtractThinkingFromFragments:
    """JSON split across multiple fragments."""

    def test_extract_thinking_from_fragments(self) -> None:
        ext = ThinkingExtractor()
        full = json.dumps({"thinking": "step by step", "action": "search"})

        # Split into small fragments of varying sizes.
        fragments = [full[i:i + 5] for i in range(0, len(full), 5)]
        all_main: list[str] = []
        all_thinking: list[str] = []

        for frag in fragments:
            m, t = ext.process_fragment(frag)
            all_main.append(m)
            all_thinking.append(t)

        assert ext.thinking == "step by step"
        main = json.loads(ext.main_json)
        assert main == {"action": "search"}

    def test_single_char_fragments(self) -> None:
        ext = ThinkingExtractor()
        full = json.dumps({"thinking": "ok", "x": 1})

        for ch in full:
            ext.process_fragment(ch)

        assert ext.thinking == "ok"
        main = json.loads(ext.main_json)
        assert main == {"x": 1}


class TestExtractThinkingFirstKey:
    """Thinking is the first key (the expected/common case)."""

    def test_extract_thinking_first_key(self) -> None:
        ext = ThinkingExtractor()
        # Manually construct to guarantee key order.
        text = '{"thinking": "reasoning here", "tool_param": "value"}'
        ext.process_fragment(text)

        assert ext.thinking == "reasoning here"
        main = json.loads(ext.main_json)
        assert main == {"tool_param": "value"}


class TestExtractThinkingWithEscapedQuotes:
    """Thinking value contains escaped quotes."""

    def test_extract_thinking_with_escaped_quotes(self) -> None:
        ext = ThinkingExtractor()
        # The thinking value: He said "hello" to me
        text = '{"thinking": "He said \\"hello\\" to me", "reply": "hi"}'
        ext.process_fragment(text)

        assert ext.thinking == 'He said "hello" to me'
        main = json.loads(ext.main_json)
        assert main == {"reply": "hi"}

    def test_extract_thinking_with_newlines(self) -> None:
        ext = ThinkingExtractor()
        text = '{"thinking": "line1\\nline2", "x": 1}'
        ext.process_fragment(text)

        assert ext.thinking == "line1\nline2"
        main = json.loads(ext.main_json)
        assert main == {"x": 1}

    def test_extract_thinking_with_backslashes(self) -> None:
        ext = ThinkingExtractor()
        text = '{"thinking": "path\\\\to\\\\file", "x": 1}'
        ext.process_fragment(text)

        assert ext.thinking == "path\\to\\file"


class TestNoThinkingKey:
    """JSON without thinking key passes through unchanged."""

    def test_no_thinking_key(self) -> None:
        ext = ThinkingExtractor()
        text = '{"message": "Hello!", "action": "greet"}'
        main_delta, thinking_delta = ext.process_fragment(text)

        assert thinking_delta == ""
        assert ext.thinking == ""
        # The entire input should pass through to main_json.
        main = json.loads(ext.main_json)
        assert main == {"message": "Hello!", "action": "greet"}

    def test_thinking_key_not_first(self) -> None:
        """If thinking is NOT the first key, it goes to main_json (by design)."""
        ext = ThinkingExtractor()
        text = '{"action": "search", "thinking": "some thought"}'
        ext.process_fragment(text)

        assert ext.thinking == ""
        main = json.loads(ext.main_json)
        assert "thinking" in main


class TestEmptyFragments:
    """Empty string fragments handled gracefully."""

    def test_empty_fragments(self) -> None:
        ext = ThinkingExtractor()
        m1, t1 = ext.process_fragment("")
        assert m1 == ""
        assert t1 == ""

        m2, t2 = ext.process_fragment("")
        assert m2 == ""
        assert t2 == ""

        # After empty fragments, still works normally.
        text = '{"thinking": "hi", "x": 1}'
        ext.process_fragment(text)
        assert ext.thinking == "hi"
        main = json.loads(ext.main_json)
        assert main == {"x": 1}

    def test_empty_interspersed(self) -> None:
        """Empty fragments interspersed with real fragments."""
        ext = ThinkingExtractor()
        ext.process_fragment("")
        ext.process_fragment('{"think')
        ext.process_fragment("")
        ext.process_fragment('ing": "yo", ')
        ext.process_fragment("")
        ext.process_fragment('"k": 1}')
        ext.process_fragment("")

        assert ext.thinking == "yo"
        main = json.loads(ext.main_json)
        assert main == {"k": 1}


class TestEdgeCases:
    """Additional edge cases."""

    def test_only_thinking_key(self) -> None:
        """JSON with only the thinking key produces empty main_json object."""
        ext = ThinkingExtractor()
        text = '{"thinking": "solo"}'
        ext.process_fragment(text)

        assert ext.thinking == "solo"
        # main_json is just "}" — prepend "{" gives "{}" which is valid.
        main = json.loads(ext.main_json)
        assert main == {}

    def test_whitespace_around_colon(self) -> None:
        ext = ThinkingExtractor()
        text = '{ "thinking" : "spaced", "a": 1}'
        ext.process_fragment(text)

        assert ext.thinking == "spaced"
        main = json.loads(ext.main_json)
        assert main == {"a": 1}

    def test_custom_thinking_key(self) -> None:
        ext = ThinkingExtractor(thinking_key="inner_thought")
        text = '{"inner_thought": "custom key", "data": true}'
        ext.process_fragment(text)

        assert ext.thinking == "custom key"
        main = json.loads(ext.main_json)
        assert main == {"data": True}

    def test_properties_accumulate(self) -> None:
        """The main_json and thinking properties reflect all fragments."""
        ext = ThinkingExtractor()
        ext.process_fragment('{"thinking": "a')
        ext.process_fragment('b", "x": ')
        ext.process_fragment('1}')

        assert ext.thinking == "ab"
        main = json.loads(ext.main_json)
        assert main == {"x": 1}
