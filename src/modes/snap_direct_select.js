import MapboxDraw from "@mapbox/mapbox-gl-draw";
import { createSnapList, IDS, snap } from "./../utils";

const { doubleClickZoom } = MapboxDraw.lib;
const DirectSelect = MapboxDraw.modes.direct_select;
const Constants = MapboxDraw.constants;
const SnapDirectSelect = { ...DirectSelect };

SnapDirectSelect.onSetup = function (opts) {
  const featureId = opts.featureId;
  const feature = this.getFeature(featureId);

  if (!feature) {
    throw new Error("You must provide a featureId to enter direct_select mode");
  }

  if (feature.type === Constants.geojsonTypes.POINT) {
    throw new TypeError("direct_select mode doesn't handle point features");
  }

  let layers = this.map.getStyle().layers;
  const targetLayers = layers.filter(layerInfo => {
    const { type, source } = layerInfo;
    if ((source !== 'mapbox-gl-draw-cold' && source !== 'mapbox-gl-draw-hot') && (type === 'circle' || type === 'line' || type === 'fill')) {
      return true;
    };
  });
  let targetLayersId = targetLayers.map((layerInfo) => {
    return layerInfo.id;
  });
  const state = {
    prevQueryBbox: null,
    targetLayersId,
    map: this.map,
    featureId,
    feature,
    dragMoveLocation: opts.startPos || null,
    dragMoving: false,
    canDragMove: false,
    selectedCoordPaths: opts.coordPath ? [opts.coordPath] : []
  };

  state.options = this._ctx.options;

  this.setSelectedCoordinates(
    this.pathsToCoordinates(featureId, state.selectedCoordPaths)
  );
  this.setSelected(featureId);
  doubleClickZoom.disable(this);

  this.setActionableState({
    trash: true,
  });

  const draw = this._ctx.api;
  const updateSnapList = () => {
    const [snapList, vertices] = createSnapList(this.map, draw, feature);
    state.vertices = vertices;
    state.snapList = snapList;
  };
  Object.assign(draw, { updateSnapList });

  const optionsChangedCallBAck = (options) => {
    state.options = options;
  };

  // for removing listener later on close
  state["optionsChangedCallBAck"] = optionsChangedCallBAck;
  this.map.on("draw.snap.options_changed", optionsChangedCallBAck);

  return state;
};

SnapDirectSelect.dragVertex = function (state, e, delta) {
  state.halfSize = ((state.options.snapOptions && state.options.snapOptions.cacheSize) || 100) / 2;
  const halfCacheSize = state.halfSize - 15;
  const { x, y } = e.point;
  if (!state.prevQueryBbox || (state.prevQueryBbox && !(state.prevQueryBbox[0] < x && state.prevQueryBbox[2] > x && state.prevQueryBbox[1] < y && state.prevQueryBbox[3] > y))) {
    const [snapList, vertices] = createSnapList(state, this._ctx.api, e);

    state.snapList = snapList;

    state.vertices = vertices;

    state.prevQueryBbox = [
      x - halfCacheSize,
      y - halfCacheSize,
      x + halfCacheSize,
      y + halfCacheSize
    ]
  }

  const { lng, lat } = snap(state, e);

  if (!lng || !lat) {
    return;
  }

  state.feature.updateCoordinate(state.selectedCoordPaths[0], lng, lat);
};

SnapDirectSelect.onStop = function (state) {
  this.deleteFeature(IDS.VERTICAL_GUIDE, { silent: true });
  this.deleteFeature(IDS.HORIZONTAL_GUIDE, { silent: true });
  state.prevQueryBbox = null;
  this.map.off("draw.snap.options_changed", state.optionsChangedCallBAck);

  DirectSelect.onStop.call(this, state);
};

export default SnapDirectSelect;
