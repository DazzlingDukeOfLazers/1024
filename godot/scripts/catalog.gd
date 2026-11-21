extends RefCounted
## Reads the shared scale catalog (same schema as fixtures/objects.json) and
## turns each object into a log10 value in SI units.
##
## The catalog's decimal strings stay the authoritative values: the viewer shows
## them as written. Only placement on screen uses floats, and only in log space,
## so nothing here overflows or underflows across the 80 decades on show.

const FILES := ["res://data/objects.json", "res://data/objects.godot.json"]

const LN10 := 2.302585092994046

## SI prefix symbol -> power of ten. "u" and Greek mu are accepted for micro.
const PREFIXES := {
	"Q": 30, "R": 27, "Y": 24, "Z": 21, "E": 18, "P": 15, "T": 12, "G": 9,
	"M": 6, "k": 3, "h": 2, "da": 1, "": 0, "d": -1, "c": -2, "m": -3,
	"µ": -6, "μ": -6, "u": -6, "n": -9, "p": -12, "f": -15, "a": -18,
	"z": -21, "y": -24, "r": -27, "q": -30,
}

## Units that do not take prefixes, as [dimension, metres-or-seconds per unit].
## Matches src/core/units/units.ts: all of these are exact definitions.
const FIXED_UNITS := {
	"min": ["time", 60.0],
	"h": ["time", 3600.0],
	"d": ["time", 86400.0],
	"a": ["time", 31557600.0],
	"au": ["length", 149597870700.0],
	"ly": ["length", 9460730472580800.0],
}

const BASES := {"m": "length", "s": "time"}

## How a unit symbol is shown. The catalog writes the Julian year as "a" (the
## SI annum); on screen "yr" reads better.
const DISPLAY_UNIT := {"a": "yr"}


static func lg10(x: float) -> float:
	return log(x) / LN10


## [dimension, log10 of the unit in SI], or [] for a unit we do not know.
static func unit_log10(unit: String) -> Array:
	if FIXED_UNITS.has(unit):
		return [FIXED_UNITS[unit][0], lg10(FIXED_UNITS[unit][1])]
	if unit.is_empty():
		return []
	var base := unit.substr(unit.length() - 1)
	var prefix := unit.substr(0, unit.length() - 1)
	if BASES.has(base) and PREFIXES.has(prefix):
		return [BASES[base], float(PREFIXES[prefix])]
	return []


## log10 of a positive decimal string such as "1.616255e-35" or "93e9", without
## ever forming the number itself (so 1e-44 and 1e27 are equally safe).
static func decimal_log10(text: String) -> float:
	var s := text.strip_edges().to_lower()
	var exponent := 0
	var e := s.find("e")
	if e >= 0:
		exponent = s.substr(e + 1).to_int()
		s = s.substr(0, e)
	var mantissa := s.to_float()
	if mantissa <= 0.0:
		return NAN
	return lg10(mantissa) + exponent


## Pick the quantity an object is placed by for one dimension: the only one, or
## the one marked primary (the same rule as primaryLength in schema.ts).
static func _quantity_for(obj: Dictionary, dimension: String) -> Array:
	var matches := []
	for key in obj.get("quantities", {}):
		var q: Dictionary = obj["quantities"][key]
		if q.get("dimension", "") == dimension:
			matches.append([key, q])
	if matches.size() == 1:
		return matches[0]
	for m in matches:
		if m[1].get("primary", false):
			return m
	return []


static func _entry(obj: Dictionary, key: String, q: Dictionary) -> Dictionary:
	var unit_info := unit_log10(q.get("unit", ""))
	if unit_info.is_empty():
		push_warning("Unknown unit %s on %s" % [q.get("unit", ""), obj.get("id", "?")])
		return {}
	var unit_lg: float = unit_info[1]
	var lg := decimal_log10(str(q.get("representative", ""))) + unit_lg
	if is_nan(lg):
		return {}
	var entry := {
		"id": obj.get("id", ""),
		"name": obj.get("name", ""),
		"categories": obj.get("categories", []),
		"dimension": q["dimension"],
		"key": key,
		"log10": lg,
		"declared": "%s %s" % [q.get("representative", ""), DISPLAY_UNIT.get(q.get("unit", ""), q.get("unit", ""))],
		"approximation": q.get("approximation", ""),
		"source": q.get("source", ""),
		"note": q.get("note", ""),
		"range": [],
	}
	var r = q.get("range", null)
	if r is Dictionary:
		entry["range"] = [
			decimal_log10(str(r.get("min", ""))) + unit_lg,
			decimal_log10(str(r.get("max", ""))) + unit_lg,
		]
		entry["range_declared"] = "%s – %s %s" % [r.get("min", ""), r.get("max", ""), DISPLAY_UNIT.get(q.get("unit", ""), q.get("unit", ""))]
	return entry


## Returns {"length": [entries...], "time": [entries...]}, each sorted small to large.
static func load_catalog() -> Dictionary:
	var out := {"length": [], "time": []}
	for path in FILES:
		var text := FileAccess.get_file_as_string(path)
		if text.is_empty():
			push_error("Could not read %s" % path)
			continue
		var parsed = JSON.parse_string(text)
		if not (parsed is Array):
			push_error("%s is not a JSON array" % path)
			continue
		for obj in parsed:
			for dimension in out:
				var picked := _quantity_for(obj, dimension)
				if picked.is_empty():
					continue
				var entry := _entry(obj, picked[0], picked[1])
				if not entry.is_empty():
					out[dimension].append(entry)
	for dimension in out:
		out[dimension].sort_custom(func(a, b): return a["log10"] < b["log10"])
	return out
