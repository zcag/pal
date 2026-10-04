# Licenses and sources

Every file in this set, where it came from, and its licence. CC0 assets need no attribution; it is recorded anyway.

## Skies (Poly Haven, CC0 1.0)

| file | source | author |
|---|---|---|
| sky/clear_midday.* | [countrytrax_midday](https://polyhaven.com/a/countrytrax_midday) | Dimitrios Savva, Jarod Guest |
| sky/partly_cloudy.* | [rural_asphalt_road](https://polyhaven.com/a/rural_asphalt_road) | Alexander Scholten |
| sky/golden_hour.* | [goegap_road](https://polyhaven.com/a/goegap_road) | Greg Zaal, James Ray Cock |
| sky/overcast.* | [overcast_soil](https://polyhaven.com/a/overcast_soil) | Sergej Majboroda |
| sky/night.* | [kloppenheim_02](https://polyhaven.com/a/kloppenheim_02) | Greg Zaal |

Backgrounds are tone-mapped renders of the 4K HDRIs; the .hdr.jpg files are gain-map re-encodings of a 1K downsample.

## Ground textures (CC0 1.0)

| files | source | author |
|---|---|---|
| tex/asphalt_worn_* | ambientCG [Asphalt031](https://ambientcg.com/view?id=Asphalt031) | ambientCG (Lennart Demes) |
| tex/asphalt_new_* | Poly Haven [asphalt_pit_lane](https://polyhaven.com/a/asphalt_pit_lane) | Dimitrios Savva |
| tex/grass_* | ambientCG [Grass004](https://ambientcg.com/view?id=Grass004) | ambientCG (Lennart Demes) |
| tex/dry_grass_* | Poly Haven [withered_grass](https://polyhaven.com/a/withered_grass) | Charlotte Baglioni |
| tex/gravel_* | Poly Haven [gravel_floor_02](https://polyhaven.com/a/gravel_floor_02) | Jenelle van Heerden, Dimitrios Savva |
| tex/concrete_* | ambientCG [Concrete031](https://ambientcg.com/view?id=Concrete031) | ambientCG (Lennart Demes) |
| tex/snow_* | ambientCG [Snow006](https://ambientcg.com/view?id=Snow006) | ambientCG (Lennart Demes) |
| tex/sand_* | Poly Haven [dense_sand](https://polyhaven.com/a/dense_sand) | Dimitrios Savva |

## Props

| file | sources |
|---|---|
| props/guardrail.json | procedural (built for this set in tools/props.html) (CC0 1.0, generated); ambientCG Metal032 (CC0 1.0, ambientCG (Lennart Demes)) |
| props/jersey_barrier.json | procedural (built for this set in tools/props.html) (CC0 1.0, generated); ambientCG Concrete031 (CC0 1.0, ambientCG (Lennart Demes)) |
| props/light_pole.json | procedural (built for this set in tools/props.html) (CC0 1.0, generated); ambientCG Metal032 (CC0 1.0, ambientCG (Lennart Demes)) |
| props/sign_gantry.json | procedural (built for this set in tools/props.html) (CC0 1.0, generated); ambientCG Metal032 (CC0 1.0, ambientCG (Lennart Demes)) |
| props/sign_speed_limit.json | procedural (built for this set in tools/props.html) (CC0 1.0, generated); ambientCG Metal032 (CC0 1.0, ambientCG (Lennart Demes)) |
| props/sign_curve_warning.json | procedural (built for this set in tools/props.html) (CC0 1.0, generated); ambientCG Metal032 (CC0 1.0, ambientCG (Lennart Demes)) |
| props/sign_direction.json | procedural (built for this set in tools/props.html) (CC0 1.0, generated); ambientCG Metal032 (CC0 1.0, ambientCG (Lennart Demes)) |
| props/delineator.json | procedural (built for this set in tools/props.html) (CC0 1.0, generated) |
| props/house.json | procedural (built for this set in tools/props.html) (CC0 1.0, generated); ambientCG PaintedPlaster017 (CC0 1.0, ambientCG (Lennart Demes)); ambientCG RoofingTiles014A (CC0 1.0, ambientCG (Lennart Demes)) |
| props/warehouse.json | procedural (built for this set in tools/props.html) (CC0 1.0, generated); ambientCG CorrugatedSteel005 (CC0 1.0, ambientCG (Lennart Demes)); ambientCG Concrete031 (CC0 1.0, ambientCG (Lennart Demes)) |
| props/tree_oak.json | EZ-Tree (MIT, Daniel Greenheck) |
| props/tree_aspen.json | EZ-Tree (MIT, Daniel Greenheck) |
| props/tree_pine.json | EZ-Tree (MIT, Daniel Greenheck) |
| props/tree_pine_tall.json | EZ-Tree (MIT, Daniel Greenheck) |
| props/bush_a.json | EZ-Tree (MIT, Daniel Greenheck) |
| props/bush_b.json | EZ-Tree (MIT, Daniel Greenheck) |
| props/rock_boulder.json | Poly Haven boulder_01 (CC0 1.0, Rico Cilliers) |
| props/rock_flat.json | Poly Haven namaqualand_boulder_05 (CC0 1.0, Jenelle van Heerden, Dario Barresi) |
| props/rock_set.json | Poly Haven rock_moss_set_01 (CC0 1.0, Kless Gyzen) |

Procedural props were built for this set from three.js primitives (tools/props.html) and are released CC0. Their textures are ambientCG CC0 materials, resized. Sign faces are drawn on a canvas; place names on them are fictional.

### EZ-Tree (trees and bushes): MIT licence

Trees and bushes were generated with EZ-Tree v1.1.0 presets (Oak Medium, Aspen Medium, Pine Medium, Pine Large, Bush 1, Bush 2) and exported to glTF; the bark and leaf textures are the ones bundled in the package. The MIT licence asks that its notice travel with copies:

```
MIT License

Copyright (c) 2024 Daniel Greenheck

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Code

sky/decode.js extends three.js's UltraHDRLoader (MIT, three.js authors). The Ultra HDR files were encoded with @monogrid/gainmap-js (MIT).
