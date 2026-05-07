"""
Построение build graph по AST: Merkle rollup + явные рёбра.

Использование:
  python tests/tools/ast_build_graph.py [program.ast.json]

Узел:
  contentHash — SHA256(канонический JSON «собственного» payload без дочерних rollup).
  rollupHash — SHA256( bytes(contentHash) + concat(bytes(child rollupHash)) );
    лист без детей: rollupHash == contentHash.

Верхний уровень:
  programShellHash / programFullHash = rollupHash узлов program:shell / program:full.

edges[]: { from, to, type } — помимо children[] для визуализации / DAG / параллели.

Версия формата: schemas/schema-versions.json → buildGraphFormatVersion
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any, List, Mapping, MutableMapping, Sequence

from canonical_ast_json import dumps_canonical

BUILD_GRAPH_FORMAT_VERSION = 2


def subtree_hash(obj: Any) -> str:
    """Полный канонический отпечаток поддерева (отладка / совместимость)."""
    payload = dumps_canonical(obj).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _digest_canonical(obj: Any) -> bytes:
    return hashlib.sha256(dumps_canonical(obj).encode("utf-8")).digest()


def _merkle_rollup(content_digest: bytes, child_rollup_hexes: Sequence[str]) -> str:
    if not child_rollup_hexes:
        return content_digest.hex()
    parts = content_digest + b"".join(bytes.fromhex(h) for h in child_rollup_hexes)
    return hashlib.sha256(parts).hexdigest()


def _program_shell(prog: Mapping[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in ("__type__", "schemaVersion", "config", "globals", "scenarios", "blocks"):
        if key in prog:
            out[key] = prog[key]
    return out


def _handler_semantic_base(h: Mapping[str, Any], index: int) -> str:
    kind = str(h.get("kind", "unknown"))
    trig = h.get("trigger")
    if trig is None or trig == "":
        return f"handler:{kind}"
    if isinstance(trig, list):
        inner = ",".join(str(x) for x in trig)
        return f"handler:{kind}:{inner}"
    return f"handler:{kind}:{trig}"


def _unique_semantic_ids(handlers: Sequence[Mapping[str, Any]]) -> List[str]:
    seen: dict[str, int] = {}
    out: List[str] = []
    for i, h in enumerate(handlers):
        base = _handler_semantic_base(h, i)
        n = seen.get(base, 0)
        seen[base] = n + 1
        out.append(base if n == 0 else f"{base}#{n}")
    return out


def _collect_stmt_nodes(
    stmt: Mapping[str, Any],
    node_id: str,
    nodes: List[MutableMapping[str, Any]],
    edges: List[MutableMapping[str, str]],
    parent_id: str,
    edge_type: str,
) -> None:
    stype = stmt.get("__type__", "unknown")

    if parent_id:
        edges.append({"from": parent_id, "to": node_id, "type": edge_type})

    if stype == "If":
        payload = {"__type__": stmt.get("__type__"), "condition": stmt.get("condition")}
    elif stype == "SwitchStmt":
        payload = {"__type__": stmt.get("__type__"), "variable": stmt.get("variable")}
    else:
        payload = dict(stmt)

    entry: MutableMapping[str, Any] = {
        "id": node_id,
        "kind": "stmt",
        "stmtType": stype,
        "children": [],
        "_content_payload": payload,
        "subtreeHash": subtree_hash(stmt),
    }
    nodes.append(entry)
    ch: List[str] = entry["children"]

    if stype == "If":
        then_body = stmt.get("then_body") or []
        else_body = stmt.get("else_body") or []
        for i, s in enumerate(then_body):
            cid = f"{node_id}:then:{i}"
            ch.append(cid)
            _collect_stmt_nodes(s, cid, nodes, edges, node_id, "control_flow_then")
        for i, s in enumerate(else_body):
            cid = f"{node_id}:else:{i}"
            ch.append(cid)
            _collect_stmt_nodes(s, cid, nodes, edges, node_id, "control_flow_else")
        return

    if stype == "SwitchStmt":
        cases = stmt.get("cases") or []
        for i, pair in enumerate(cases):
            if not isinstance(pair, (list, tuple)) or len(pair) != 2:
                continue
            label, body = pair[0], pair[1]
            arm_root = f"{node_id}:case:{i}:{label}"
            arm_payload = {"label": label}
            nodes.append(
                {
                    "id": arm_root,
                    "kind": "switch_arm",
                    "stmtType": "SwitchArm",
                    "children": [],
                    "_content_payload": arm_payload,
                    "subtreeHash": subtree_hash({"label": label, "body": body}),
                    "meta": {"variant": label},
                },
            )
            edges.append({"from": node_id, "to": arm_root, "type": "switch_variant"})
            ch.append(arm_root)
            arm_entry = nodes[-1]
            ac = arm_entry["children"]
            if isinstance(body, list):
                for j, s in enumerate(body):
                    cid = f"{arm_root}:s{j}"
                    ac.append(cid)
                    _collect_stmt_nodes(s, cid, nodes, edges, arm_root, "contains")


def _finalize_merkle(nodes: List[MutableMapping[str, Any]]) -> None:
    by_id = {n["id"]: n for n in nodes}
    memo: dict[str, str] = {}

    def rollup(nid: str) -> str:
        if nid in memo:
            return memo[nid]
        n = by_id[nid]
        child_hexes = [rollup(cid) for cid in n["children"]]
        payload = n.pop("_content_payload", {})
        cd = _digest_canonical(payload)
        rh = _merkle_rollup(cd, child_hexes)
        n["contentHash"] = cd.hex()
        n["rollupHash"] = rh
        memo[nid] = rh
        return rh

    for nid in by_id:
        rollup(nid)


def build_graph(ast: Mapping[str, Any]) -> dict[str, Any]:
    if ast.get("__type__") != "Program":
        raise ValueError("Ожидается корень AST с __type__ == Program")

    nodes: List[MutableMapping[str, Any]] = []
    edges: List[MutableMapping[str, str]] = []

    shell = _program_shell(ast)
    handlers = ast.get("handlers") or []
    semantic_ids = _unique_semantic_ids(handlers)

    handler_row_ids: List[str] = []
    for i, h in enumerate(handlers):
        hid = f"handler:{i}"
        sem = semantic_ids[i]
        row = {
            "id": hid,
            "kind": "handler",
            "semanticId": sem,
            "children": [],
            "_content_payload": {"kind": h.get("kind"), "trigger": h.get("trigger")},
            "meta": {"handlerKind": h.get("kind"), "trigger": h.get("trigger")},
            "subtreeHash": subtree_hash(h),
        }
        nodes.append(row)
        handler_row_ids.append(hid)

        body = h.get("body") or []
        hc = row["children"]
        for j, stmt in enumerate(body):
            sid = f"{hid}:s{j}"
            hc.append(sid)
            _collect_stmt_nodes(stmt, sid, nodes, edges, hid, "contains")

    full_payload = {
        "rollupRole": "program_full",
        "schemaVersion": ast.get("schemaVersion"),
        "__type__": ast.get("__type__"),
    }

    nodes.insert(
        0,
        {
            "id": "program:shell",
            "kind": "program_shell",
            "children": handler_row_ids.copy(),
            "_content_payload": shell,
            "meta": {"note": "config/globals/scenarios/blocks без handlers"},
            "subtreeHash": subtree_hash(shell),
        },
    )
    nodes.insert(
        1,
        {
            "id": "program:full",
            "kind": "program_full",
            "children": handler_row_ids.copy(),
            "_content_payload": full_payload,
            "meta": {"note": "Merkle-слой полной программы (не сериализует handlers)"},
            "subtreeHash": subtree_hash(ast),
        },
    )

    for hid in handler_row_ids:
        edges.append({"from": "program:shell", "to": hid, "type": "contains"})
        edges.append({"from": "program:full", "to": hid, "type": "contains"})

    _finalize_merkle(nodes)

    shell_node = nodes[0]
    full_node = nodes[1]

    out = {
        "buildGraphFormatVersion": BUILD_GRAPH_FORMAT_VERSION,
        "merkleRootHash": full_node["rollupHash"],
        "programShellHash": shell_node["rollupHash"],
        "programFullHash": full_node["rollupHash"],
        "programSubtreeFingerprint": subtree_hash(ast),
        "nodes": nodes,
        "edges": sorted(edges, key=lambda e: (e["from"], e["to"], e["type"])),
    }
    if "schemaVersion" in ast:
        out["sourceAstSchemaVersion"] = ast["schemaVersion"]
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="AST → incremental build graph (Merkle + edges)")
    parser.add_argument("file", nargs="?", default=None, help="JSON AST (иначе stdin)")
    args = parser.parse_args()

    if args.file:
        raw = Path(args.file).expanduser().read_text(encoding="utf-8")
    else:
        raw = sys.stdin.read()
    raw = raw.replace("\r\n", "\n").strip()
    if not raw:
        print("Пустой ввод AST.", file=sys.stderr)
        return 2

    ast = json.loads(raw)
    try:
        graph = build_graph(ast)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2

    sys.stdout.write(dumps_canonical(graph))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
