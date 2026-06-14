/**
 * The default DetectionTelemetry observer (Phase 5c; phase5-tts-strangler.md
 * §5c.2): computes the offline-analysis payload from the detector's raw
 * observation and writes it to the GenAI activity log. The ~125 lines of
 * feature engineering that lived inline in AudioContentPipeline now hang off
 * the detector as an INJECTED observer — the detector itself stays free of
 * logging concerns and tests can pass a recording stub (or nothing).
 */
import { generateSecureId } from '../crypto';
import type { GenAIPort } from './engine/EngineContext';
import type { DetectionObservation, DetectionTelemetry } from './ReferenceSectionDetector';
import { REFERENCE_ENUMERATOR_RE } from './ReferenceSectionDetector';

/** Normalizes a numeric marker/enumerator to its bare digits (e.g. "[3]" → "3"), else null. */
function normalizeEnumerator(text: string): string | null {
    const m = /(\d+)/.exec(text);
    return m ? m[1] : null;
}

export function createGenAILogTelemetry(genAI: Pick<GenAIPort, 'addLog'>): DetectionTelemetry {
    return {
        onDetection(observation: DetectionObservation): void {
            const {
                bookId, sectionId, groups, markers, markerGroupIndex,
                geminiCfi, detShadowCfi, enumeratorCandidateIndex, markerDropoffIndex,
                agreedWithHeuristic, justification,
            } = observation;
            const n = groups.length;

            // Per-group marker counts (and whether any leading marker attributes there) from the
            // shared attribution. leadsWithMarker is the position-aware signal now fed to the model.
            const groupMarkerCounts = new Array(n).fill(0);
            const groupLeadsWithMarker = new Array(n).fill(false);
            markers.forEach((mk, mi) => {
                const gi = markerGroupIndex[mi];
                if (gi >= 0 && gi < n) {
                    groupMarkerCounts[gi]++;
                    if (mk.leading) groupLeadsWithMarker[gi] = true;
                }
            });

            // Per-group features. startCfi/endCfi are the exact segment bounds used by
            // attributeMarkersToGroups — pairing them with markerDetail below makes orphaned
            // markers (groupIndex -1) diagnosable: compare a marker's cfi against the bounds.
            const perGroup = groups.map((g, i) => {
                const m = REFERENCE_ENUMERATOR_RE.exec(g.fullText);
                const enumeratorValue = m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
                const enumeratorType = m
                    ? (m[1] ? 'bracketed' : m[2] ? 'dotted' : 'spaced')
                    : null;
                return {
                    groupIndex: i,
                    fractionFromEnd: n > 1 ? (n - 1 - i) / (n - 1) : 0,
                    enumeratorType,
                    enumeratorValue,
                    markerCount: groupMarkerCounts[i],
                    leadsWithMarker: groupLeadsWithMarker[i],
                    segmentCount: g.segments.length,
                    startCfi: g.segments[0]?.cfi,
                    endCfi: g.segments[g.segments.length - 1]?.cfi,
                };
            });

            // Per-marker dump: full marker metadata plus the group it attributed to (-1 = orphaned).
            // Lets offline analysis reconstruct exactly why a marker landed inside or outside a group.
            const markerDetail = markers.map((mk, mi) => ({
                cfi: mk.cfi,
                markerText: mk.markerText,
                super: mk.super,
                numeric: mk.numeric,
                glued: mk.glued,
                targetHref: mk.targetHref,
                groupIndex: markerGroupIndex[mi] ?? -1,
            }));

            // Body = first 60% of groups; tail = last 40%.
            // bodyMarkerSet holds normalized numeric markers found in the body; tailEnumeratorSet
            // holds enumerators starting tail groups. High overlap → tail enumerates body citations.
            const bodyThreshold = Math.floor(n * 0.6);
            const bodyMarkerSet = new Set<string>();
            markers.forEach((mk, mi) => {
                const gi = markerGroupIndex[mi];
                if (gi !== -1 && gi < bodyThreshold && mk.numeric) {
                    const norm = normalizeEnumerator(mk.markerText);
                    if (norm) bodyMarkerSet.add(norm);
                }
            });

            const tailGroups = groups.slice(bodyThreshold);
            const tailEnumeratorSet = new Set<string>();
            let longestTailEnumeratorRun = 0;
            let curRun = 0;
            for (const g of tailGroups) {
                const m = REFERENCE_ENUMERATOR_RE.exec(g.fullText);
                if (m) {
                    const val = m[1] ?? m[2] ?? m[3];
                    if (val) tailEnumeratorSet.add(val);
                    curRun++;
                    if (curRun > longestTailEnumeratorRun) longestTailEnumeratorRun = curRun;
                } else {
                    curRun = 0;
                }
            }

            const overlap = [...bodyMarkerSet].filter(v => tailEnumeratorSet.has(v)).length;
            const setOverlapFraction = tailEnumeratorSet.size > 0
                ? overlap / tailEnumeratorSet.size
                : 0;

            genAI.addLog({
                id: generateSecureId(),
                timestamp: Date.now(),
                type: 'response',
                method: 'detectReferenceStart',
                payload: {
                    bookId,
                    sectionId,
                    groupCount: n,
                    markerCount: markers.length,
                    orphanMarkerCount: markerGroupIndex.filter(gi => gi === -1).length,
                    geminiCfi,
                    detShadowCfi,
                    enumeratorCandidateIndex,
                    markerDropoffIndex,
                    agreedWithHeuristic,
                    justification,
                    setOverlapFraction,
                    longestTailEnumeratorRun,
                    bodyMarkerSet: [...bodyMarkerSet],
                    tailEnumeratorSet: [...tailEnumeratorSet],
                    markerDetail,
                    perGroup,
                },
            });
        },
    };
}
