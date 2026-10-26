"""
Generate DFD Level 1 Diagram for PQC-DNSSEC MTL Benchmark Testbed.
Uses direct matplotlib to render a clean, presentation-ready,
uncluttered Data Flow Diagram (DFD Level 1) under 15 shapes.
Also outputs the companion PlantUML .puml code into the uml/ directory.
"""

import os
from PIL import Image
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.patches import FancyBboxPatch, BoxStyle

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uml")
os.makedirs(OUTPUT_DIR, exist_ok=True)

PUML_FILE = os.path.join(OUTPUT_DIR, "dfd_level1.puml")
JPG_FILE = os.path.join(OUTPUT_DIR, "dfd_level1.jpg")

DFD_PUML_CODE = """@startuml PQC_DNSSEC_MTL_DFD_Level1
skinparam monochrome true
skinparam style strictuml
skinparam shadowing false
skinparam roundcorner 5
skinparam defaultFontName Arial
skinparam defaultFontSize 11
skinparam nodesep 35
skinparam ranksep 35

title **PQC-DNSSEC MTL BENCHMARK TESTBED - DATA FLOW DIAGRAM (DFD LEVEL 1)**

package "External Entities" as Ent {
    [E1: Benchmark Operator\\n(CLI / Workbench UI)] as E1
    [E2: IANA Hints Repo\\n(named.root)] as E2
}

package "Core Processes (Level 1)" as Proc {
    [1.0 Setup & Hints Prep] as P1
    [2.0 Zone Signing Engine] as P2
    [3.0 Hierarchical DNS Resolver] as P3
    [4.0 PQC Validator & Benchmarking] as P4
}

database "Data Stores" as Stores {
    folder "D1: Zone & Key Store" as D1
    folder "D2: Root Hints Store" as D2
    folder "D3: Ladder Cache" as D3
    folder "D4: Results Store" as D4
}

E2 -> P1 : (1) Fetch named.root
E1 -> P1 : (2) Run setup
P1 -> D2 : (3) Save lab-root.hints
E1 -> P2 : (4) Trigger signing
P2 <-> D1 : (5/6) Read / Save zones
E1 -> P4 : (7) Run benchmark
P4 -> P3 : (8) Query DO=1
D2 ..> P3 : (9) Read hints
D1 ..> P3 : (10) Mount zones
P3 -> P4 : (11) Answer + RRSIG
P4 <-> D3 : (12) Read / cache ladder
D1 ..> P4 : (13) Read trust anchor
P4 -> E1 : (14) SECURE status
P4 -> D4 : (15) Export metrics

legend bottom
|= Step |= Description |
| (1)-(3)  | Hints Setup: Downloads raw IANA hints and rewrites IP mapping to lab root container |
| (4)-(6)  | Zone Signing: Generates ML-DSA-44/ECDSA keys, builds MTL tree, saves signed zone files |
| (7)-(11) | Query Resolution: Dispatches queries; Recursor resolves down delegation chain; returns answer |
| (12)-(15)| PQC Validation & Logging: Verifies Merkle path/ladder, outputs SECURE status, exports telemetry |
endlegend

@enduml
"""

def generate_dfd_diagram():
    # 1. Write the PUML companion code
    with open(PUML_FILE, "w", encoding="utf-8") as f:
        f.write(DFD_PUML_CODE)
    print(f"Saved PlantUML DFD file: {PUML_FILE}")

    # 2. Render direct high-res Matplotlib image (perfect landscape, zero line overlaps)
    fig, ax = plt.subplots(figsize=(19, 9), dpi=300)
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.axis("off")

    # Title Banner
    ax.text(50, 96, "PQC-DNSSEC MTL BENCHMARK TESTBED - DATA FLOW DIAGRAM (DFD LEVEL 1)",
            fontsize=15, fontweight="bold", ha="center", va="center", color="#000000")

    # Draw Gane & Sarson DFD elements
    def draw_entity(x, y, w, h, eid, title, sub):
        rect = patches.Rectangle((x, y), w, h, linewidth=1.8, edgecolor="#000000",
                                 facecolor="#FAFAFA", zorder=3)
        ax.add_patch(rect)
        ax.text(x + w/2, y + h*0.70, eid, fontsize=9.5, fontweight="bold", ha="center", va="center")
        ax.text(x + w/2, y + h*0.48, title, fontsize=9, fontweight="bold", ha="center", va="center")
        ax.text(x + w/2, y + h*0.25, sub, fontsize=7.8, ha="center", va="center", color="#444444")

    def draw_process(x, y, w, h, pid, title, desc):
        p = FancyBboxPatch((x, y), w, h, boxstyle=BoxStyle("Round", pad=0.5, rounding_size=1.5),
                           linewidth=1.8, edgecolor="#000000", facecolor="#FFFFFF", zorder=3)
        ax.add_patch(p)
        # Process header line
        ax.plot([x, x + w], [y + h*0.65, y + h*0.65], color="#000000", linewidth=0.8, zorder=4)
        ax.text(x + w/2, y + h*0.82, pid, fontsize=9.5, fontweight="bold", ha="center", va="center")
        ax.text(x + w/2, y + h*0.45, title, fontsize=9, fontweight="bold", ha="center", va="center")
        ax.text(x + w/2, y + h*0.20, desc, fontsize=7.5, ha="center", va="center", color="#555555")

    def draw_store(x, y, w, h, sid, title, path):
        # Open-ended horizontal parallel lines (Standard DFD)
        ax.plot([x, x + w], [y + h, y + h], color="#000000", linewidth=1.8, zorder=3)
        ax.plot([x, x + w], [y, y], color="#000000", linewidth=1.8, zorder=3)
        ax.plot([x, x], [y, y + h], color="#000000", linewidth=1.8, zorder=3)
        bg = patches.Rectangle((x, y), w, h, facecolor="#F8FAFC", edgecolor="none", zorder=2)
        ax.add_patch(bg)
        ax.text(x + w/2, y + h*0.66, f"{sid}: {title}", fontsize=8.8, fontweight="bold", ha="center", va="center")
        ax.text(x + w/2, y + h*0.30, path, fontsize=7.5, ha="center", va="center", color="#4B5563")

    def draw_flow(x1, y1, x2, y2, label="", rad=0.0, dashed=False, label_offset=(0, 0)):
        ls = "--" if dashed else "-"
        arrow = patches.FancyArrowPatch((x1, y1), (x2, y2),
                                        connectionstyle=f"arc3,rad={rad}",
                                        arrowstyle="->",
                                        mutation_scale=11,
                                        linestyle=ls,
                                        linewidth=1.1,
                                        color="#000000",
                                        zorder=4)
        ax.add_patch(arrow)
        if label:
            mx, my = (x1 + x2)/2 + label_offset[0], (y1 + y2)/2 + label_offset[1]
            if rad > 0: my += 1.8
            elif rad < 0: my -= 1.8
            ax.text(mx, my, label, fontsize=7.6, ha="center", va="center",
                    bbox=dict(boxstyle="square,pad=0.2", fc="#FFFFFF", ec="none", alpha=0.95), zorder=5)

    # 1. External Entities (Left column)
    draw_entity(3, 68, 20, 14, "EXTERNAL ENTITY E1", "Benchmark Operator", "(CLI User / Web UI)")
    draw_entity(3, 26, 20, 14, "EXTERNAL ENTITY E2", "IANA Hints Source", "(named.root Provider)")

    # 2. Level 1 Processes (Middle column)
    draw_process(38, 74, 25, 13, "PROCESS 1.0", "Setup & Hints Preparation", "Rewrites root to 172.30.53.10")
    draw_process(38, 52, 25, 13, "PROCESS 2.0", "Zone Signing Engine", "ML-DSA-44 & Merkle Ladder")
    draw_process(38, 30, 25, 13, "PROCESS 3.0", "Hierarchical DNS Resolver", "Iterative Root -> TLD -> SLD")
    draw_process(38, 8, 25, 13, "PROCESS 4.0", "PQC Validator & Benchmark", "Verifies ladder / logs stats")

    # 3. Data Stores (Right column)
    draw_store(74, 76, 23, 11, "D2", "Root Hints Store", "/config/lab-root.hints")
    draw_store(74, 54, 23, 11, "D1", "Zone & Key Store", "/zones, keys & anchors")
    draw_store(74, 32, 23, 11, "D3", "Ladder Cache", "In-Memory Merkle Tree")
    draw_store(74, 10, 23, 11, "D4", "Benchmark Results", "/results metrics & reports")

    # Flows
    # Prep
    draw_flow(23, 34, 38, 78, "(1) Fetch named.root", rad=-0.08)
    draw_flow(23, 76, 38, 81, "(2) Run setup command")
    draw_flow(63, 81, 74, 81, "(3) Save lab-root.hints")

    # Signing
    draw_flow(23, 73, 38, 60, "(4) Trigger zone signing", rad=0.04)
    draw_flow(63, 60, 74, 60, "(5/6) Read & Save zones")

    # Query & Resolution
    draw_flow(18, 68, 38, 16, "(7) Execute query", rad=0.18)
    draw_flow(52, 21, 52, 30, "(8) Recursive query (DO=1)")
    draw_flow(74, 78, 63, 39, "(9) Mount hints", rad=-0.14, dashed=True)
    draw_flow(74, 56, 63, 36, "(10) Mount zones", rad=-0.08, dashed=True)
    draw_flow(44, 30, 44, 21, "(11) Answer + condensed RRSIG")
    draw_flow(63, 16, 74, 35, "(12) Read/store ladder", rad=-0.10)
    draw_flow(74, 58, 63, 19, "(13) Read trust anchor", rad=0.12, dashed=True)
    draw_flow(38, 12, 12, 68, "(14) Return SECURE status", rad=-0.18)
    draw_flow(63, 13, 74, 13, "(15) Export metrics")

    plt.tight_layout()
    plt.savefig(JPG_FILE, format="jpeg", dpi=300)
    plt.close()
    print(f"Generated clean high-resolution JPG: {JPG_FILE}")

if __name__ == "__main__":
    generate_dfd_diagram()
