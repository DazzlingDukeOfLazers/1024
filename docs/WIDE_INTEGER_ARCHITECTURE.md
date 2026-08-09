# Wide Fixed-Point / Digit-Serial Architecture Experiment

## Status

This is an **experimental architecture track** for the Scale Atlas / Numerical Microscope.

It is a thought experiment to simulate and benchmark, not a claim that this is already a better general-purpose CPU architecture.

The hypothesis is:

> A machine can expose very wide fixed-point architectural values while using a much smaller physical arithmetic slice over multiple cycles.

Instead of putting a moving exponent inside every number, the machine uses a fixed binary lattice, preserves wide intermediate results, and makes information loss explicit.

A concise design principle:

> **Keep the bits until someone explicitly chooses to throw them away.**

And when information does not fit:

> **Return the leftovers.**

---

# 1. Architectural width versus physical ALU width

Do not assume that a 1024-bit architectural number requires a monolithic 1024-bit multiplier or divider.

Example:

```text
Architectural scalar width: 1024 bits
Physical arithmetic slice:    64 bits
```

The physical engine may consist mostly of:

```text
shift
mask
compare
add/subtract
small multiply
wide accumulator
leading-zero detection
control/state machine
```

Wide operations become multi-cycle instructions.

This deliberately trades:

```text
more cycles
```

for potentially:

```text
less dedicated wide combinational hardware
simpler arithmetic primitives
explicit numerical behavior
```

The simulator should measure that trade rather than assume the result.

---

# 2. Radix-2^N digits

Split a wide value into digits whose radix is a power of two.

For example:

```text
1024-bit value
N = 64
16 digits
```

Mathematically:

```text
A = Σ ai × 2^(64i)
```

A split operation is trivial binary structure:

```text
LOW  = A & (2^N - 1)
HIGH = A >> N
```

No approximation is introduced.

The physical digit size should be configurable:

```text
8
16
32
64
128 bits
```

This lets the project compare:

- smaller arithmetic slice, more cycles;
- larger arithmetic slice, fewer cycles;
- switching activity;
- carry work;
- partial-product count;
- storage/work scheduling.

---

# 3. Significant-width execution

A declared 1024-bit value should not automatically require 1024 bits of useful arithmetic.

Before an operation, determine:

```text
BITLEN
CLZ
CTZ
highest nonzero digit
lowest nonzero digit
```

Possible dispatch:

```text
active <= 8 bits      → tiny path
active <= 16 bits     → tiny path
active <= 32 bits     → native path
active <= 64 bits     → native path
active <= 128 bits    → medium path
otherwise             → digit-serial wide path
```

This is a major experiment.

The simulator should report both:

```text
declared width
actual significant width touched
```

A nominally 1024-bit machine may often process far less than 1024 meaningful bits.

---

# 4. Zero-digit skipping

When a radix-2^N digit is zero, many operations involving it can be skipped.

Example:

```text
A = 2^700 + 2^12
```

The register is wide, but its information content is sparse.

For multiplication, partial products involving a zero digit are zero and can potentially be omitted.

Measure:

```text
total possible digit operations
digits inspected
nonzero digits
partial products executed
partial products skipped
modeled control overhead
```

Do not assume skipping is free. Make its control cost configurable.

---

# 5. Addition and subtraction

For equal-scale fixed-point values:

```text
A + B
A - B
```

are exact if the result fits.

No exponent alignment is required.

No magnitude-dependent resolution change occurs.

Return explicit status:

```text
VALUE
CARRY / BORROW
OVERFLOW
```

Scenario policies may include:

```text
TRAP
WIDEN
SATURATE
WRAP
```

For educational/default behavior, prefer `TRAP` or `WIDEN`.

---

# 6. Multiplication by decomposition

Let:

```text
A = Σ ai × 2^(Ni)
B = Σ bj × 2^(Nj)
```

Then:

```text
A × B = ΣΣ (ai × bj) × 2^(N(i+j))
```

For a 1024-bit number with 64-bit digits:

```text
16 × 16 = 256 possible partial products
```

Each partial product has an exact destination bit position.

Conceptual physical engine:

```text
wide source registers
        |
select digits
        |
64 × 64 → 128 primitive multiplier
        |
position / shift
        |
wide accumulator
        |
exact wide product
```

## Reintegration

For multiplication, reintegration is not numerically fragile.

Because every digit is a power-of-two chunk, each partial product is added into a known exact bit position.

If the accumulator is wide enough, recombination is exact integer arithmetic.

The implementation problems are:

- scheduling;
- carries;
- storage;
- latency;
- power;
- throughput.

They are not floating-point-style rounding problems.

---

# 7. Wide multiply first, narrow later

Do not define multiplication as:

```text
1024 × 1024 → silently rounded 1024
```

Prefer:

```text
MUL_WIDE
1024 × 1024 → 2048
```

Likewise:

```text
Q128.128 × Q128.128
```

should first produce the mathematically appropriate wider intermediate.

Only later should the program choose a destination format.

This separates:

```text
calculation
```

from:

```text
information loss
```

---

# 8. Narrowing is explicit

Introduce an architectural operation:

```text
NARROW source → destination + residue
```

Possible policies:

```text
EXACT_REQUIRED
TRUNCATE
ROUND_NEAREST
ROUND_TIES_EVEN
ROUND_UP
ROUND_DOWN
SATURATE
WRAP
TRAP_INEXACT
FLAG_INEXACT
KEEP_RESIDUE
ACCUMULATE_RESIDUE
```

The visualization should show:

```text
FULL RESULT
|-------------------------------|

DESTINATION
|-------------|

RESIDUE / LOST BITS
              |-----------------|
```

The user should be able to switch policies and see the resulting value change.

---

# 9. Division returns quotient and remainder

The primitive division contract should be:

```text
DIV_REM A, B
→ quotient Q
→ remainder R
```

with the invariant:

```text
A = Q × B + R
```

For conventional unsigned magnitude division:

```text
0 <= R < B
```

The remainder is not a failure.

It is exact information describing what did not fit in the quotient.

Do **not** conceptually add the remainder back into the quotient.

Keep it alive as a first-class result.

---

# 10. Digit-serial division

A large dedicated combinational divider is not required by the architectural contract.

`DIV_REM` may be a multi-cycle operation implemented with a smaller engine using:

```text
SHIFT
COMPARE
SUBTRACT
ADD
BITLEN / CLZ
```

The simulator should allow several algorithms later, including:

```text
restoring
non-restoring
radix-2
radix-2^N
reciprocal-based
hybrid native-small / iterative-large
```

Do not lock the project to one algorithm until benchmarks exist.

---

# 11. Fixed-point division

For a destination with `F` fractional bits, conceptual fixed-point division can scale the numerator:

```text
(A << F) / B
```

and return:

```text
Q
R
```

such that:

```text
A × 2^F = Q × B + R
```

At this point, the quotient and remainder together still describe the calculation exactly.

Loss occurs only when a policy discards or compresses `R`.

---

# 12. Continue for more quotient digits

The remainder can generate more precision.

Given a radix `2^N` engine:

```text
R <<= N
generate another quotient digit
```

This allows division to be demand-driven:

```text
give me 64 fractional bits
give me another 64
continue until exact
continue until tolerance is met
continue until destination is full
```

Execution time can therefore scale with requested precision.

This should become a visible experiment in the app.

---

# 13. Residue is a first-class numerical object

Operations that discard or defer information should return that information.

A result object may conceptually contain:

```text
value
residue
exact
overflow
inexact
sourceWidth
destinationWidth
significantBitsProcessed
digitsProcessed
modeledCycles
```

Residue may be:

```text
discarded
used for rounding
retained
converted to an exact rational
accumulated
used to raise an exception
```

This is part of the architecture hypothesis.

---

# 14. Scenario settings

The user should be able to define the machine contract.

Example:

```yaml
architecture:
  registerBits: 1024
  digitBits: 64
  multiplyPrimitiveBits: 64

overflow:
  policy: trap

narrowing:
  policy: round_ties_even

division:
  remainderPolicy: keep
  precisionPolicy: destination

optimization:
  significantWidthDispatch: true
  skipZeroDigits: true
```

The same workload should be runnable under different policies.

Example comparison:

```text
Scenario A: preserve everything
Scenario B: round to destination
Scenario C: trap on any inexact result
Scenario D: truncate and discard residue
```

---

# 15. Proposed virtual ISA

Initial ISA:

```text
ADD
SUB

SHL
SHR

CMP
CLZ
CTZ
BITLEN

SPLIT
EXTEND
NARROW

MUL_WIDE
DIV_REM
```

Possible later instructions:

```text
MAC_WIDE
ABS
NEG
GCD
SQRT
CONVERT_SCALE
```

An architectural instruction does not imply one-cycle hardware.

For example:

```text
MUL_WIDE 1024
```

may invoke a long digit-serial microprogram internally.

---

# 16. Minimal physical engine thought experiment

One possible engine:

```text
wide register storage
small arithmetic slice
small multiplier
wide accumulator
shift network
compare
leading-zero detector
carry/borrow logic
microcode/state machine
```

General wide division may initially have no dedicated divider.

This is a simulation candidate, not a requirement.

---

# 17. GPU prototype

A GPU is a practical virtual platform for the experiment.

Represent:

```text
U1024 = 32 × u32 limbs
```

or another limb width appropriate to the compute API.

Map one logical wide scalar onto cooperating lanes/threads.

Potential organizations:

```text
one workgroup per wide scalar
one warp/subgroup per wide scalar
one thread owns several limbs
```

The GPU is acting as a virtual wide arithmetic processor, not as a pixel renderer.

---

# 18. WebGPU implementation track

The browser version can use WebGPU compute.

Start with `u32` limbs:

```text
array<u32, 32>
```

for one 1024-bit value.

Suggested implementation order:

```text
ADD
SUB
BITLEN
SHL
SHR
MUL_WIDE
DIV_REM
```

The browser UI can visualize the operation while the compute shader performs it.

---

# 19. CPU exact oracle

Every experimental implementation must be checked against a CPU oracle.

For randomized `A` and `B`:

```text
virtual ALU result
vs.
BigInt / exact rational result
```

Compare bit-for-bit.

Especially test:

```text
all-zero
all-one
min/max signed
long carry chains
long borrow chains
single-bit sparse values
dense random values
leading-zero-heavy values
division exact
division with remainder
overflow
narrowing
```

The simulator must never use its own result as its correctness reference.

---

# 20. Metrics

Measure numerical behavior and computational work separately.

Suggested metrics:

```text
architectural width
significant width
digit width
digits inspected
nonzero digits
partial products possible
partial products executed
partial products skipped
add/sub operations
shift operations
carry work
quotient digits generated
wide temporary bits
residue bits
overflow events
narrowing events
exact/inexact result
modeled cycles
bytes moved
```

For real GPU implementations also measure, where practical:

```text
kernel execution time
values per second
effective wide operations per second
memory traffic
```

---

# 21. Comparison targets

The architecture lab should eventually compare:

```text
binary32
binary64
simulated binary128

Q fixed-point
wide digit-serial fixed-point
exact rational reference
```

Interesting workloads:

```text
coordinate accumulation
CAD geometry
PCB geometry
microscopic coordinates
astronomical coordinates
timers
matrix transforms
repeated rotations
integration
cancellation-heavy arithmetic
```

Do not assume one architecture wins every workload.

---

# 22. Visualizations

## Wide number chunks

```text
[ a15 ][ a14 ][ ... ][ a2 ][ a1 ][ a0 ]
```

Highlight active versus zero digits.

## Significant width

Show:

```text
1024-bit architectural register
[00000000000000000000000000000000101101]
                                  ^^^^^^
                                  active
```

## Multiplication matrix

```text
       b0  b1  b2  ... bn
a0     ×   ×   ×       ×
a1     ×   ×   ×       ×
a2     ×   ×   ×       ×
...
an     ×   ×   ×       ×
```

Skipped zero partial products can fade out.

## Accumulation

Animate:

```text
small product
→ exact shift
→ wide accumulator
```

## Division

Continuously display:

```text
A = Q × B + R
```

Animate quotient digits and remainder.

## Narrowing

Display:

```text
full exact result
destination
residue
policy
final result
```

---

# 23. Important precision statement

This architecture does **not** eliminate every finite-representation error.

It changes where error occurs.

For same-scale fixed-point addition/subtraction:

```text
exact unless overflow
```

For multiplication/division:

```text
wide result/remainder may be exact
```

Error enters when a finite destination or explicit narrowing policy is chosen.

That differs fundamentally from floating-point magnitude-dependent spacing.

The application should communicate this distinction carefully.

---

# 24. Research question

The project should eventually ask:

> If we trade a floating-point numerical contract for very wide fixed-point architectural values plus a smaller iterative arithmetic engine, what do we gain and what do we pay?

Potential gains to test:

```text
constant absolute resolution
exact same-scale add/subtract
explicit loss boundaries
wide exact intermediates
quotient + remainder semantics
variable work based on significant width
potentially simpler arithmetic primitives
```

Potential costs to test:

```text
storage width
memory bandwidth
latency
worst-case multiplication/division
carry propagation
scale management
power
throughput
poor fit for some workloads
```

The simulator exists to replace intuition with measurements.

---

# 25. Project principle

> **Keep the bits until someone explicitly chooses to throw them away.**

If they do:

> **Show which bits were lost, preserve the residue when requested, and make the policy visible.**
