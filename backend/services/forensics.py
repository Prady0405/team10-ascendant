"""Statistical forensic models.

These functions exist specifically to avoid asserting false certainty.
Claiming "100% mathematically proven jamming" is a credibility risk in any
real incident/insurance dispute — an adversary expert can always point to
an edge case (simultaneous power failure, a wind gust at the same moment
GPS was obstructed by terrain). Instead we compute the statistical
probability that a multi-sensor fingerprint matches a known fault profile,
and the rule engine (services/rules.py) decides what to do with that
number. Nothing here touches AI — this is still 100% deterministic math.
"""

import math

from utils import config


def signal_disruption_probability(
    delta_satellites: float,
    hdop: float | None,
    kinetic_jitter_variance: float | None,
) -> float:
    """P(J | S_t, D_t, sigma^2_K) — probability the sensor fingerprint at
    this instant matches localized GPS jamming/signal disruption.

    Model: P(J) = 1 / (1 + exp(-beta * (w1*dS + w2*D_t + w3*sigma^2_K - theta)))

    Where:
      delta_satellites   = S_baseline - S_t, the acute drop in satellite locks
      hdop               = horizontal dilution of precision (higher = worse fix)
      kinetic_jitter_variance = Var(ax) + Var(ay) + Var(az) over a trailing window
                            (the airframe physically struggling while blind)

    `hdop` and `kinetic_jitter_variance` are optional — when a source
    doesn't provide them, their term simply drops out of the weighted sum
    rather than crashing or defaulting to a misleading zero-risk value.
    """
    weighted_sum = config.SIGNAL_DISRUPTION_WEIGHT_SATELLITE_DROP * delta_satellites
    if hdop is not None:
        weighted_sum += config.SIGNAL_DISRUPTION_WEIGHT_HDOP * hdop
    if kinetic_jitter_variance is not None:
        weighted_sum += config.SIGNAL_DISRUPTION_WEIGHT_JITTER * kinetic_jitter_variance

    exponent = -config.SIGNAL_DISRUPTION_BETA * (weighted_sum - config.SIGNAL_DISRUPTION_THETA)
    # Guard against float overflow on extreme inputs; math.exp(710+) raises OverflowError.
    exponent = max(-700.0, min(700.0, exponent))
    return 1.0 / (1.0 + math.exp(exponent))
