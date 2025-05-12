// Heavily inspired from work of @davidgilbertson on Github and `leaflet-geoman` project.
import MapboxDraw from "@mapbox/mapbox-gl-draw";

const { geojsonTypes } = MapboxDraw.constants;

import bboxPolygon from "@turf/bbox-polygon";
import booleanDisjoint from "@turf/boolean-disjoint";
import { getCoords } from "@turf/invariant";
import distance from "@turf/distance";
import polygonToLine from "@turf/polygon-to-line";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import cleanCoords from "@turf/clean-coords";
import nearestPointInPointSet from "@turf/nearest-point";
import {
  featureCollection,
  lineString as turfLineString,
  point as turfPoint,
} from "@turf/helpers";

export const IDS = {
  VERTICAL_GUIDE: "VERTICAL_GUIDE",
  HORIZONTAL_GUIDE: "HORIZONTAL_GUIDE",
};

const getFormattedPolygonFeature = (feature) => {
  const draw = feature.ctx.api;
  const mode = draw.getMode();
  let coordinates;
  if (mode === 'direct_select') {
    // direct_select状态下，需要过滤掉当前选中点
    const selectedPointsFeatureCollection = draw.getSelectedPoints();
    const selectedPoint = selectedPointsFeatureCollection?.features?.[0]?.geometry?.coordinates;
    if (selectedPoint) {
      const x = selectedPoint[0];
      const y = selectedPoint[1];
      coordinates = [
        feature.coordinates[0].filter((point) => {
          return point[0] !== x && point[1] !== y;
        })
      ];
    } else {
      coordinates = feature.coordinates;
    }
  } else {
    // 单面coordinates结构为[[[x,y],[x,y],...]]，在绘制状态下，当前feature内，最后一位为当前鼠标位置，且是没有绘制的，所以需要去掉最后一位
    coordinates = [feature.coordinates[0].slice(0, -1)];
  }
  return {
    id: feature.id,
    properties: feature.properties,
    geometry: {
      coordinates,
      type: feature.type
    },
    type: "Feature"
  };
};

const getFormattedMultiPolygonFeatures = (feature) => {
  const currentFeatures = [];
  feature.features.forEach((feat) => {
    if (feat.type === 'Polygon' && feat.coordinates?.[0]?.length > 2) {
      const currentFeat = getFormattedPolygonFeature(feat);
      currentFeatures.push(currentFeat);
    }
    if (feat.type === 'MultiPolygon') {
      const feautures = getFormattedMultiPolygonFeatures(feat);
      currentFeatures.push(...feautures);
    }
  });
  return currentFeatures
};

const getFormattedLineFeature = (feature) => {
  const draw = feature.ctx.api;
  const mode = draw.getMode();
  let coordinates;
  if (mode === 'direct_select') {
    // direct_select状态下，需要过滤掉当前选中点
    const selectedPointsFeatureCollection = draw.getSelectedPoints();
    const selectedPoint = selectedPointsFeatureCollection?.features?.[0]?.geometry?.coordinates;
    if (selectedPoint) {
      const x = selectedPoint[0];
      const y = selectedPoint[1];
      coordinates = feature.coordinates.filter((point) => {
        return point[0] !== x && point[1] !== y;
      });
    } else {
      coordinates = feature.coordinates;
    }

  } else {
    // 单线coordinates结构为[[x,y],[x,y],...]，在绘制状态下，当前feature内，最后一位为当前鼠标位置，且是没有绘制的，所以需要去掉最后一位
    coordinates = feature.coordinates.slice(0, -1);
  }
  return {
    id: feature.id,
    properties: feature.properties,
    geometry: {
      coordinates,
      type: feature.type
    },
    type: "Feature"
  };
};
const getFormattedMultiLineFeatures = (feature) => {
  const currentFeatures = [];
  feature.features.forEach((feat) => {
    if (feat.type === 'LineString' && feat.coordinates?.length > 2) {
      const currentFeat = getFormattedLineFeature(feat);
      currentFeatures.push(currentFeat);
    }
    if (feat.type === 'MultiLineString') {
      const feautures = getFormattedMultiLineFeatures(feat);
      currentFeatures.push(...feautures);
    }
  });
  return currentFeatures;
};


export const addPointToVertices = (
  map,
  vertices,
  coordinates,
  forceInclusion
) => {
  const { width: w, height: h } = map.getCanvas();
  // Just add vertices of features currently visible in viewport
  const { x, y } = map.project(coordinates);
  const pointIsOnTheScreen = x > 0 && x < w && y > 0 && y < h;

  // But do add off-screen points if forced (e.g. for the current feature)
  // So features will always snap to their own points
  if (pointIsOnTheScreen || forceInclusion) {
    vertices.push(coordinates);
  }
};


export const createSnapList = (map, draw, params, getFeatures) => {
  const currentFeature = params.currentFeature;
  let snapFeatures = params.snapFeatures ?? [];

  // Get all features
  let features = [];

  if (typeof getFeatures === "function") {
    features = getFeatures(map, draw);
  }

  if (!Array.isArray(features) || features.length === 0) {
    features = draw.getAll().features;
  }
  features = snapFeatures.length ? [...features, ...snapFeatures] : features;

  const snapList = [];

  // Get current bbox as polygon
  const bboxAsPolygon = (() => {
    const canvas = map.getCanvas(),
      w = canvas.width,
      h = canvas.height,
      cUL = map.unproject([0, 0]).toArray(),
      cUR = map.unproject([w, 0]).toArray(),
      cLR = map.unproject([w, h]).toArray(),
      cLL = map.unproject([0, h]).toArray();

    return bboxPolygon([cLL, cUR].flat());
  })();

  const vertices = [];

  // Keeps vertices for drawing guides
  const addVerticesToVertices = (coordinates, isCurrentFeature = false) => {
    if (!Array.isArray(coordinates)) throw Error("Your array is not an array");

    if (Array.isArray(coordinates[0])) {
      // coordinates is an array of arrays, we must go deeper
      coordinates.forEach((coord) => {
        addVerticesToVertices(coord);
      });
    } else {
      // If not an array of arrays, only consider arrays with two items
      if (coordinates.length === 2) {
        addPointToVertices(map, vertices, coordinates, isCurrentFeature);
      }
    }
  };

  features.forEach((feature) => {
    // For current feature
    if (feature.id === currentFeature.id) {
      if (currentFeature.type === geojsonTypes.POLYGON) {
        // For the current polygon, the last two points are the mouse position and back home
        // so we chop those off (else we get vertices showing where the user clicked, even
        // if they were just panning the map)
        addVerticesToVertices(
          feature.geometry.coordinates[0].slice(0, -2),
          true
        );
      }
      return;
    }

    // If this is re-running because a user is moving the map, the features might include
    // vertices or the last leg of a polygon
    if (
      feature.id === IDS.HORIZONTAL_GUIDE ||
      feature.id === IDS.VERTICAL_GUIDE
    )
      return;

    addVerticesToVertices(feature.geometry.coordinates);

    // If feature is currently on viewport add to snap list
    if (!booleanDisjoint(bboxAsPolygon, feature)) {
      snapList.push(feature);
    }
  });

  if (currentFeature.type === 'Polygon') {
    // 判断是否已经绘制出了一个线段
    if (currentFeature.coordinates?.[0]?.length > 2) {
      const currentFeat = getFormattedPolygonFeature(currentFeature);
      return [[...snapList, currentFeat], vertices];
    }
  }
  if (currentFeature.type === 'LineString') {
    // 判断是否已经绘制出了一个线段
    if (currentFeature.coordinates?.length > 2) {
      const currentFeat = getFormattedLineFeature(currentFeature);
      return [[...snapList, currentFeat], vertices];
    }
  }
  if (currentFeature.type === "MultiPolygon") {
    const currentFeatures = getFormattedMultiPolygonFeatures(currentFeature);
    return [[...snapList, ...currentFeatures], vertices];
  }
  if (currentFeature.type === "MultiLineString") {
    const currentFeatures = getFormattedMultiLineFeatures(currentFeature);
    return [[...snapList, ...currentFeatures], vertices];
  }
  return [snapList, vertices];
};

const getNearbyVertices = (vertices, coords) => {
  const verticals = [];
  const horizontals = [];

  vertices.forEach((vertex) => {
    verticals.push(vertex[0]);
    horizontals.push(vertex[1]);
  });

  const nearbyVerticalGuide = verticals.find(
    (px) => Math.abs(px - coords.lng) < 0.009
  );

  const nearbyHorizontalGuide = horizontals.find(
    (py) => Math.abs(py - coords.lat) < 0.009
  );

  return {
    verticalPx: nearbyVerticalGuide,
    horizontalPx: nearbyHorizontalGuide,
  };
};

const calcLayerDistances = (lngLat, layer) => {
  // the point P which we want to snap (probably the marker that is dragged)
  const P = [lngLat.lng, lngLat.lat];

  // is this a marker?
  const isMarker = layer.geometry.type === "Point";
  // is it a polygon?
  const isPolygon = layer.geometry.type === "Polygon";
  // is it a multiPolygon?
  const isMultiPolygon = layer.geometry.type === "MultiPolygon";
  // is it a multiPoint?
  const isMultiPoint = layer.geometry.type === "MultiPoint";

  let lines = undefined;

  // the coords of the layer
  const latlngs = getCoords(layer);

  if (isMarker) {
    const [lng, lat] = latlngs;
    // return the info for the marker, no more calculations needed
    return {
      latlng: { lng, lat },
      distance: distance(latlngs, P),
    };
  }

  if (isMultiPoint) {
    const np = nearestPointInPointSet(
      P,
      featureCollection(latlngs.map((x) => turfPoint(x)))
    );
    const c = np.geometry.coordinates;
    return {
      latlng: { lng: c[0], lat: c[1] },
      distance: np.properties.distanceToPoint,
    };
  }

  if (isPolygon || isMultiPolygon) {
    lines = polygonToLine(layer);
  } else {
    lines = layer;
  }

  let nearestPoint;
  if (isPolygon) {
    let lineStrings;
    if (lines.geometry.type === "LineString") {
      lineStrings = [turfLineString(lines.geometry.coordinates)];
    } else {
      lineStrings = lines.geometry.coordinates.map((coords) =>
        turfLineString(coords)
      );
    }

    const closestFeature = getFeatureWithNearestPoint(lineStrings, P);
    lines = closestFeature.feature;
    nearestPoint = closestFeature.point;
  } else if (isMultiPolygon) {
    const lineStrings = lines.features
      .map((feat) => {
        if (feat.geometry.type === "LineString") {
          return [feat.geometry.coordinates];
        } else {
          return feat.geometry.coordinates;
        }
      })
      .flatMap((coords) => coords)
      .map((coords) => turfLineString(coords));

    const closestFeature = getFeatureWithNearestPoint(lineStrings, P);
    lines = closestFeature.feature;
    nearestPoint = closestFeature.point;
  } else {
    // nearestPointOnLine接口在feature内有相同坐标的情况下会报错，需要用cleanCoords处理
    const cleanedFeat = cleanCoords(lines);
    nearestPoint = nearestPointOnLine(cleanedFeat, P);
  }

  const [lng, lat] = nearestPoint.geometry.coordinates;

  let segmentIndex = nearestPoint.properties.index;

  let { coordinates } = lines.geometry;

  if (lines.geometry.type === "MultiLineString") {
    coordinates =
      lines.geometry.coordinates[nearestPoint.properties.multiFeatureIndex];
  }

  if (segmentIndex + 1 === coordinates.length) segmentIndex--;

  return {
    latlng: { lng, lat },
    segment: coordinates.slice(segmentIndex, segmentIndex + 2),
    distance: nearestPoint.properties.dist,
    isMarker,
  };
};

function getFeatureWithNearestPoint(lineStrings, P) {
  const nearestPointsOfEachFeature = lineStrings.map((feat) => {
    const cleanedFeat = cleanCoords(feat);
    return {
      feature: cleanedFeat,
      point: nearestPointOnLine(cleanedFeat, P),
    }
  });

  nearestPointsOfEachFeature.sort(
    (a, b) => a.point.properties.dist - b.point.properties.dist
  );

  return {
    feature: nearestPointsOfEachFeature[0].feature,
    point: nearestPointsOfEachFeature[0].point,
  };
}

const calcClosestLayer = (lngLat, layers) => {
  let closestLayer = {};

  // loop through the layers
  layers.forEach((layer, index) => {
    // find the closest latlng, segment and the distance of this layer to the dragged marker latlng
    const results = calcLayerDistances(lngLat, layer);

    // save the info if it doesn't exist or if the distance is smaller than the previous one
    if (
      closestLayer.distance === undefined ||
      results.distance < closestLayer.distance
    ) {
      closestLayer = results;
      closestLayer.layer = layer;
    }
  });

  // return the closest layer and it's data
  // if there is no closest layer, return undefined
  return closestLayer;
};

// minimal distance before marker snaps (in pixels)
const metersPerPixel = function (latitude, zoomLevel) {
  const earthCircumference = 40075017;
  const latitudeRadians = latitude * (Math.PI / 180);
  return (
    (earthCircumference * Math.cos(latitudeRadians)) /
    Math.pow(2, zoomLevel + 8)
  );
};

// we got the point we want to snap to (C), but we need to check if a coord of the polygon
function snapToLineOrPolygon(
  closestLayer,
  snapOptions,
  snapVertexPriorityDistance,
  lngLat
) {
  const {
    snapToMidPoints = false,
    snapToNodes = true,
    snapToEndPoints = true,
    snapToLines = true,
  } = snapOptions ?? {};
  const geometry = closestLayer.layer.geometry;

  // A and B are the points of the closest segment to P (the marker position we want to snap)
  const A = closestLayer.segment[0];
  const B = closestLayer.segment[1];

  // C is the point we would snap to on the segment.
  // The closest point on the closest segment of the closest polygon to P. That's right.
  const C = [closestLayer.latlng.lng, closestLayer.latlng.lat];

  // distances from A to C and B to C to check which one is closer to C
  const distanceAC = distance(A, C);
  const distanceBC = distance(B, C);

  // closest latlng of A and B to C
  let closestVertexLatLng = distanceAC < distanceBC ? A : B;

  // distance between closestVertexLatLng and C
  let shortestDistance = distanceAC < distanceBC ? distanceAC : distanceBC;
  // snap to middle (M) of segment if option is enabled
  let isMiddlePoint = false;
  if (snapToMidPoints) {
    const M = [
      (A[0] + B[0]) / 2,
      (A[1] + B[1]) / 2
    ];
    const distanceMC = distance(M, C);

    if (distanceMC < distanceAC && distanceMC < distanceBC) {
      // M is the nearest vertex
      closestVertexLatLng = M;
      shortestDistance = distanceMC;
      isMiddlePoint = true
    }
  }

  // the distance that needs to be undercut to trigger priority
  const priorityDistance = snapVertexPriorityDistance;

  // 线段的端点坐标
  const endPoints = geometry.type === "LineString" ? [geometry.coordinates[0], geometry.coordinates[geometry.coordinates.length - 1]] : [];
  // 判断是否为端点
  const isEndPoint = endPoints.find((point) => {
    return point[0] === closestVertexLatLng[0] && point[1] === closestVertexLatLng[1];
  });
  // the latlng we ultemately want to snap to
  let snapLatlng;

  // if C is closer to the closestVertexLatLng (A, B or M) than the snapDistance,
  // the closestVertexLatLng has priority over C as the snapping point.
  // 当最短距离大于或等于最优距离且启用了 snapToLines 时，使用 C 点进行捕捉，否则不捕捉
  if (shortestDistance >= priorityDistance) {
    snapLatlng = snapToLines ? C : lngLat;
  } else {
    // 如果没有开启 snapToNodes、snapToMidPoints 和 snapToEndPoints，则不进行捕捉
    // 如果没有开启 snapToNodes 和 snapToMidPoints，但开启了 snapToEndPoints，则捕捉到端点
    const shouldSnapToLngLat =
      // 确保不是中间点
      !isMiddlePoint &&
      // 确保没有捕捉到节点
      !snapToNodes &&
      (
        // 如果启用了捕捉到端点，且不是端点
        (snapToEndPoints && !isEndPoint) ||
        // 如果禁用了捕捉到端点
        !snapToEndPoints
      );
    snapLatlng = shouldSnapToLngLat ? (snapToLines ? C : lngLat) : closestVertexLatLng;
  }

  // return the copy of snapping point
  const [lng, lat] = snapLatlng;
  return { lng, lat };
}

function snapToPoint(closestLayer) {
  return closestLayer.latlng;
}

const checkPrioritySnapping = (
  closestLayer,
  snapOptions,
  snapVertexPriorityDistance = 1.25,
  lngLat
) => {
  let snappingToPoint = !Array.isArray(closestLayer.segment);
  if (snappingToPoint) {
    return snapToPoint(closestLayer);
  } else {
    return snapToLineOrPolygon(
      closestLayer,
      snapOptions,
      snapVertexPriorityDistance,
      lngLat
    );
  }
};

function getPixelByLngLat(lnglat1, lnglat2, map) {
  // map.project() 方法：把经纬度坐标（lnglat）转换成屏幕像素坐标（也就是在地图容器内的位置，比如 {x: 512, y: 300} 这种）
  const p1 = map.project(lnglat1);
  const p2 = map.project(lnglat2);
  // 计算差值
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  // 计算两点之间的直线像素距离 距离 = √(dx² + dy²) 勾股定理
  const pixelDist = Math.sqrt(dx * dx + dy * dy);
  return pixelDist
};

/**
 * Returns snap points if there are any, otherwise the original lng/lat of the event
 * Also, defines if vertices should show on the state object
 *
 * Mutates the state object
 *
 * @param state
 * @param e
 * @returns {{lng: number, lat: number}}
 */
export const snap = (state, e) => {
  let lng = e.lngLat.lng;
  let lat = e.lngLat.lat;

  // Holding alt bypasses all snapping
  if (e.originalEvent.altKey) {
    state.showVerticalSnapLine = false;
    state.showHorizontalSnapLine = false;

    return { lng, lat };
  }

  if (state.snapList.length <= 0) {
    return { lng, lat };
  }

  // snapping is on
  let closestLayer, minDistance, snapLatLng;
  if (state.options.snap) {
    closestLayer = calcClosestLayer({ lng, lat }, state.snapList);

    // if no layers found. Can happen when circle is the only visible layer on the map and the hidden snapping-border circle layer is also on the map
    if (Object.keys(closestLayer).length === 0) {
      return false;
    }

    if (!['Point', 'MultiPoint'].includes(closestLayer.layer.geometry.type)) {
      const A = closestLayer.segment[0];
      const B = closestLayer.segment[1];
      const pixelDist = getPixelByLngLat(A, B, state.map);
      if ((state.options.snapOptions.maxIgnorableLineLength ?? 50) > pixelDist) {
        return { lng, lat };
      }
    }

    const isMarker = closestLayer.isMarker;
    const snapVertexPriorityDistance = state.options.snapOptions
      ? state.options.snapOptions.snapVertexPriorityDistance
      : undefined;

    if (!isMarker) {
      snapLatLng = checkPrioritySnapping(
        closestLayer,
        state.options.snapOptions,
        snapVertexPriorityDistance,
        [lng, lat]
      );
      // snapLatLng = closestLayer.latlng;
    } else {
      snapLatLng = closestLayer.latlng;
    }

    minDistance =
      ((state.options.snapOptions && state.options.snapOptions.snapPx) || 15) *
      metersPerPixel(snapLatLng.lat, state.map.getZoom());
  }

  let verticalPx, horizontalPx;
  if (state.options.guides) {
    const nearestGuideline = getNearbyVertices(state.vertices, e.lngLat);

    verticalPx = nearestGuideline.verticalPx;
    horizontalPx = nearestGuideline.horizontalPx;

    if (verticalPx) {
      // Draw a line from top to bottom

      const lngLatTop = { lng: verticalPx, lat: e.lngLat.lat + 10 };
      const lngLatBottom = { lng: verticalPx, lat: e.lngLat.lat - 10 };

      state.verticalGuide.updateCoordinate(0, lngLatTop.lng, lngLatTop.lat);
      state.verticalGuide.updateCoordinate(
        1,
        lngLatBottom.lng,
        lngLatBottom.lat
      );
    }

    if (horizontalPx) {
      // Draw a line from left to right

      const lngLatTop = { lng: e.lngLat.lng + 10, lat: horizontalPx };
      const lngLatBottom = { lng: e.lngLat.lng - 10, lat: horizontalPx };

      state.horizontalGuide.updateCoordinate(0, lngLatTop.lng, lngLatTop.lat);
      state.horizontalGuide.updateCoordinate(
        1,
        lngLatBottom.lng,
        lngLatBottom.lat
      );
    }

    state.showVerticalSnapLine = !!verticalPx;
    state.showHorizontalSnapLine = !!horizontalPx;
  }

  if (closestLayer && closestLayer.distance * 1000 < minDistance) {
    return snapLatLng;
  } else if (verticalPx || horizontalPx) {
    if (verticalPx) {
      lng = verticalPx;
    }
    if (horizontalPx) {
      lat = horizontalPx;
    }
    return { lng, lat };
  } else {
    return { lng, lat };
  }
};

export const getGuideFeature = (id) => ({
  id,
  type: geojsonTypes.FEATURE,
  properties: {
    isSnapGuide: "true", // for styling
  },
  geometry: {
    type: geojsonTypes.LINE_STRING,
    coordinates: [],
  },
});

export const shouldHideGuide = (state, geojson) => {
  if (
    geojson.properties.id === IDS.VERTICAL_GUIDE &&
    (!state.options.guides || !state.showVerticalSnapLine)
  ) {
    return true;
  }

  if (
    geojson.properties.id === IDS.HORIZONTAL_GUIDE &&
    (!state.options.guides || !state.showHorizontalSnapLine)
  ) {
    return true;
  }

  return false;
};

/**
 * 根据地图缩放级别 (zoom) 返回顶点吸附的优先级距离
 * 随着 zoom 增大，吸附距离逐渐减小（更严格的吸附判定）
 * @param {number} zoom - 地图缩放级别（通常 0~20）
 * @returns {number} 顶点吸附的最大有效距离
 */
export const getFormattedSnapVertexPriorityDistance = (zoom) => {
  switch (true) {
    // 1. 最宏观级别（zoom ≤ 1），吸附距离最大（600）
    case zoom <= 1:
      return 600;
    // 2. 1 < zoom ≤ 2，吸附距离稍减（500）
    case zoom <= 2:
      return 500;
    // 3. 2 < zoom ≤ 3，吸附距离降至 400
    case zoom <= 3:
      return 400;
    // 4. 3 < zoom ≤ 6，线性递减：400 → 15
    case zoom <= 6:
      return 400 - (385 * (zoom - 3) / 3);
    // 5. 6 < zoom ≤ 9，线性递减：15 → 3
    case zoom <= 9:
      return 15 - (12 * (zoom - 6) / 3);
    // 6. 9 < zoom ≤ 12，线性递减：3 → 1
    case zoom <= 12:
      return 3 - (2 * (zoom - 9) / 3);
    // 7. 12 < zoom ≤ 16，线性递减：1 → 0.01
    case zoom <= 16:
      return 1 - (0.99 * (zoom - 12) / 4);
    // 8. zoom > 16，吸附距离极小（0.001）
    default:
      return 0.001;
  }
};

const snapSymbolSourceName = 'snap-indicator';
const snapSymbolName = 'snap-indicator-layer';

export const addSnapSymbol = (map) => {
  if (map.getSource(snapSymbolSourceName) || map.getLayer(snapSymbolName)) {
    return;
  }

  map.addSource(snapSymbolSourceName, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [],
    }
  });
  
  map.addLayer({
    id: snapSymbolName,
    type: 'circle',
    source: snapSymbolSourceName,
    paint: {
      'circle-radius': 6,
      'circle-color': '#00ffff'
    }
  });
};

export const updateSnapSymbol = (map, newLngLat, originLngLat)=>{
  const isSnapSuccess = newLngLat.lng !== originLngLat.lng || newLngLat.lat !== originLngLat.lat;
  map.getSource(snapSymbolSourceName).setData({
    type: 'FeatureCollection',
    features: isSnapSuccess ? [{
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [newLngLat.lng, newLngLat.lat]
      }
    }] : []
  });
};

export const deleteSnapSymbol = (map) => {
  map.getLayer(snapSymbolName) && map.removeLayer(snapSymbolName);
  map.getSource(snapSymbolSourceName) && map.removeSource(snapSymbolSourceName);
};