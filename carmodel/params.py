"""Hard dimensions in millimetres. +X forward, +Y left, +Z up, ground at z=0.

Target proportions: a mid-engine coupe, 4500 mm long, 1800 mm wide over the
haunches, 1310 mm tall, 2700 mm wheelbase, 20 inch wheels with wide rear
rubber. The widest point comes from the half-width curve in profile.py, not
from a nominal figure, so the body always matches the design curves.
"""

# overall ---------------------------------------------------------
LENGTH = 4500.0
X_NOSE = 2250.0          # envelope: bumper and lights reach here
X_TAIL = -2250.0
X_HULL_NOSE = 2232.0     # painted shell stops short so bumpers sit proud
X_HULL_TAIL = -2228.0
HALF_WIDTH = 900.0   # widest point over the haunches

# running gear ----------------------------------------------------
AXLE_F = 1350.0
AXLE_R = -1350.0
WHEEL_R = 340.0
RIM_R = 254.0            # 20 inch
TIRE_W_F = 265.0
TIRE_W_R = 305.0
WHEEL_OUTSET = 6.0       # tyre sidewall sits this far inside the widest body point

# wheel arches ----------------------------------------------------
ARCH_RX = 402.0          # half length of the opening
ARCH_APEX_F = 752.0      # crown height: must clear the tyre top (680)
ARCH_APEX_R = 758.0
WELL_CLEARANCE = 18.0    # gap between tyre inner face and well wall

# hover -----------------------------------------------------------
# Above a cruising speed the body rises and the wheels swing flat under the
# floor, outer face to the road, like the hover conversion in Back to the
# Future Part II. The swing needs more room under the car than the cruise does,
# so the body rises to FOLD_LIFT, folds, then settles to HOVER_LIFT.
FOLD_LIFT = 260.0        # body rise while the wheels swing
HOVER_LIFT = 200.0       # body rise in cruise, wheels folded
FOLD_PROUD = 150.0       # a folded tyre stands this far outside the body
FOLD_GAP = 8.0           # ...and its upper face this far under the floor

# cabin -----------------------------------------------------------
X_WS_BASE = 700.0        # windscreen base, on the cowl
X_ROOF_F = 250.0         # windscreen header
X_ROOF_R = -450.0        # rear screen header
X_RW_BASE = -1250.0      # rear screen base
FLOOR_Z = 372.0          # cockpit floor
SEAT_H = 160.0

# surface density -------------------------------------------------
HULL_STATIONS = 130
CANOPY_STATIONS = 44


def arch_list():
    """Per-axle wheel opening data derived from the tyre sizes."""
    out = []
    for axle, tire_w, apex in ((AXLE_F, TIRE_W_F, ARCH_APEX_F),
                               (AXLE_R, TIRE_W_R, ARCH_APEX_R)):
        hw = 896.0 if axle > 0 else 900.0
        track_half = hw - WHEEL_OUTSET - tire_w * 0.5
        out.append(dict(
            axle=axle,
            rx=ARCH_RX,
            apex=apex,
            track_half=track_half,
            tire_w=tire_w,
            well_inner=track_half - tire_w * 0.5 - WELL_CLEARANCE,
        ))
    return out
