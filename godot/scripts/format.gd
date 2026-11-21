extends RefCounted
## Human-readable values from log10 magnitudes. Engineering notation (powers of
## 1000 with SI prefixes) first, as CLAUDE.md rule 9 asks, plus a friendlier
## unit where SI prefixes stop helping (light-years, years).

const PREFIX_BY_EXP := {
	30: "Q", 27: "R", 24: "Y", 21: "Z", 18: "E", 15: "P", 12: "T", 9: "G", 6: "M",
	3: "k", 0: "", -3: "m", -6: "µ", -9: "n", -12: "p", -15: "f", -18: "a",
	-21: "z", -24: "y", -27: "r", -30: "q",
}

const SUPERSCRIPT := {
	"0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵",
	"6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻",
}

const LG_LY := 15.975951
const LG_MINUTE := 1.778151
const LG_HOUR := 3.556303
const LG_DAY := 4.936514
const LG_YEAR := 7.499077


static func superscript(n: int) -> String:
	var out := ""
	for c in str(n):
		out += SUPERSCRIPT.get(c, c)
	return out


## Three significant figures of 10^lg, split as [mantissa text, power of ten]
## with the power a multiple of `step` (3 for engineering, 1 for scientific).
static func _split(lg: float, step: int) -> Array:
	var p := int(floor(lg / step)) * step
	var m := pow(10.0, lg - p)
	if m >= 999.5 / (1.0 if step == 3 else 100.0):
		p += step
		m = pow(10.0, lg - p)
	var digits := 2 if m < 10.0 else (1 if m < 100.0 else 0)
	return [String.num(m, digits), p]


static func scientific(lg: float, unit: String) -> String:
	var parts := _split(lg, 1)
	return "%s × 10%s %s" % [parts[0], superscript(parts[1]), unit]


static func engineering(lg: float, unit: String) -> String:
	var parts := _split(lg, 3)
	if not PREFIX_BY_EXP.has(parts[1]):
		return scientific(lg, unit)
	return "%s %s%s" % [parts[0], PREFIX_BY_EXP[parts[1]], unit]


static func _plain(lg: float, unit: String) -> String:
	# Numbers between 1 and 999 in a non-SI unit, else words for big counts.
	var v := pow(10.0, lg)
	if v < 1000.0:
		var digits := 2 if v < 10.0 else (1 if v < 100.0 else 0)
		return "%s %s" % [String.num(v, digits), unit]
	for pair in [[12, "trillion"], [9, "billion"], [6, "million"], [3, "thousand"]]:
		var p: int = pair[0]
		if lg >= p:
			var m := pow(10.0, lg - p)
			var digits := 2 if m < 10.0 else (1 if m < 100.0 else 0)
			return "%s %s %s" % [String.num(m, digits), pair[1], unit]
	return "%s %s" % [String.num(v, 0), unit]


static func length(lg: float) -> String:
	var si := engineering(lg, "m")
	if lg >= LG_LY - 1.0:
		return "%s  (%s)" % [si, _plain(lg - LG_LY, "ly")]
	return si


static func time(lg: float) -> String:
	if lg < LG_MINUTE:
		return engineering(lg, "s")
	if lg < LG_HOUR:
		return _plain(lg - LG_MINUTE, "min")
	if lg < LG_DAY:
		return _plain(lg - LG_HOUR, "h")
	if lg < LG_YEAR:
		return _plain(lg - LG_DAY, "days")
	return _plain(lg - LG_YEAR, "years")


static func value(lg: float, dimension: String) -> String:
	return time(lg) if dimension == "time" else length(lg)
