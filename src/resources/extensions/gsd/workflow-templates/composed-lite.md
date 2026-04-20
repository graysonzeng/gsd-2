# Composed-Lite Design Pipeline

<template_meta>
name: Composed Lite
description: Design-to-delivery pipeline with independent review, verification, and anti-drift contracts
version: 1
mode: markdown-phase
requires_project: true
artifact_dir: null
executor_extension: composed-lite
triggers: composed-lite, design-and-ship, full design, 设计方案, composed lite
</template_meta>

<purpose>
Run the composed-lite design-to-delivery workflow using the dedicated GSD runtime.
This template is runtime-owned: it does not use the default workflow-start prompt path.
The composed-lite runtime manages its own phase loop, state, artifacts, and anti-drift contracts.
Requires a git project; state lives in .gsd/composed-lite/.
</purpose>

<phases>
0. admission
1. research
2. design
3. split
4. implementation
5. verification
6. delivery
7. postmortem
</phases>
