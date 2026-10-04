// How a car drives: a dynamic bicycle model in SI units, no DOM, 120 steps a
// second. The road runs along +z, x is lateral (+x is the driver's left).
//
// The tyres make the car turn: steering puts a slip angle on the front axle,
// the tyre's force rises with slip and saturates at what its load allows, the
// car yaws, the rear axle takes a slip angle of its own and follows. Weight
// moves forward under braking and back under power, so the front grips more on
// the brakes. The engine has a torque curve and an automatic gearbox that cuts
// power for a moment on each shift. Keyboard steering is digital, so a driver
// aid stands in for the hands: the wheel turns in at a rate that slows with
// speed, and with no input it holds the road's heading the way a driver would.

import { FEEL } from "./content.ts";

export type Spec = {
  mass: number; // kg
  wheelbase: number; // m
  cgFront: number; // share of the weight on the front axle
  cgHeight: number; // m
  inertia?: number; // yaw, kg m^2 (default from mass and wheelbase)
  power: number; // kW at the peak
  torque: number; // N m at the peak
  redline: number; // rpm
  idle: number; // rpm
  gears: number[]; // ratios, first to top
  final: number; // final drive
  wheelRadius: number; // m
  drag: number; // Cd * A, m^2
  grip: number; // tyre friction coefficient
  corner: number; // cornering stiffness per unit load, 1/rad
  brake: number; // max brake deceleration in g, before the tyres limit it
  steerMax: number; // road-wheel angle at a standstill, rad
  agility?: number; // how hard full lock turns at speed, in g (default 0.62)
};

export const SEDAN: Spec = {
  mass: 1350, wheelbase: 2.7, cgFront: 0.56, cgHeight: 0.52,
  power: 160, torque: 290, redline: 6800, idle: 850,
  gears: [3.5, 2.1, 1.45, 1.1, 0.88, 0.72], final: 3.7, wheelRadius: 0.32,
  drag: 0.62, grip: 1.05, corner: 16, brake: 1.0, steerMax: 0.6,
};

export type Input = { throttle: number; brake: number; steer: number }; // steer: +1 left

const G = 9.81, RHO = 1.2, CRR = 0.012, SHIFT_TIME = 0.16;
// The tyres grip harder sideways than real ones (and the car turns in faster): a lane at 160 km/h
// in about two thirds of a second, where a real car would take one and a half. The motion keeps a
// real car's shape (it yaws in, leans, settles); it is the speed of it that is a game's.
const SIDE_GRIP = 1.6;

export class Vehicle {
  // pose and motion in the road's frame
  x = 0; z = 0; yaw = 0; // yaw 0 = along +z, + turns left
  u = 0; // forward speed in the car's frame, m/s
  v = 0; // sideways speed in the car's frame (+ left)
  r = 0; // yaw rate, rad/s
  // drivetrain
  gear = 1; rpm = 850; shifting = 0; throttle = 0; braking = 0;
  // steering wheel (road-wheel angle) and the driver aid's memory
  delta = 0;
  // what the body feels, for the springs and the camera
  ax = 0; ay = 0; // longitudinal and lateral acceleration, m/s^2
  slipFront = 0; slipRear = 0; // how far each axle is into its grip (0..1+)
  wheelSpin = 0; // rad, for the wheels on screen
  steer = 0; // the driver's input, eased in as a thumb on a key does
  knocked = 0; // seconds of the tyre model taking over after a hit
  constructor(public spec: Spec) { this.rpm = spec.idle; }

  get kmh() { return this.u * 3.6; }

  /** Start rolling at a speed, in the gear a driver would be in. */
  launch(u: number) {
    const s = this.spec;
    this.u = u;
    const wheelRpm = (u / s.wheelRadius) * 30 / Math.PI;
    this.gear = 1;
    while (this.gear < s.gears.length && wheelRpm * s.gears[this.gear - 1] * s.final > s.redline * 0.8) this.gear++;
    this.rpm = Math.max(s.idle, wheelRpm * s.gears[this.gear - 1] * s.final);
  }

  /** Engine torque at an rpm: a broad plateau that falls toward the redline. */
  engineTorque(rpm: number) {
    const s = this.spec, t = rpm / s.redline;
    const shape = t < 0.25 ? 0.55 + 1.6 * t : t < 0.7 ? 0.95 + 0.05 * Math.sin((t - 0.25) / 0.45 * Math.PI) : 1 - Math.pow((t - 0.7) / 0.3, 2) * 0.35;
    // the power at the peak caps the torque high in the range
    const omega = rpm * Math.PI / 30;
    return Math.min(s.torque * shape, (s.power * 1000) / Math.max(omega, 1) * 1.05);
  }

  step(dt: number, input: Input) {
    const s = this.spec;
    const L = s.wheelbase, a = L * (1 - s.cgFront), b = L * s.cgFront; // cg to front / rear axle
    const Iz = s.inertia ?? s.mass * L * L * 0.24;
    this.throttle += (input.throttle - this.throttle) * Math.min(1, dt * 8);
    this.braking += (input.brake - this.braking) * Math.min(1, dt * 10);

    // --- steering: the aid turns the wheel in at a rate, less lock at speed
    const speed = Math.max(0, this.u);
    // full lock asks for about the car's agility in g at any speed past a crawl: lots of angle in town, a hair at 250
    const lock = Math.min(s.steerMax, ((s.agility ?? 0.62) * SIDE_GRIP * G * L * 1.5) / Math.max(speed * speed, 1));
    // the driver aims the car: holding a direction asks for a heading that crosses the road at a
    // steady sideways speed (sharper cars cross faster), letting go asks for straight down the road;
    // the wheels are steered to get there, within what the tyres allow
    const across = 8.2 + ((s.agility ?? 1.2) - 1.2) * 6; // m/s sideways
    const maxYaw = Math.min(0.5, across / Math.max(speed, 1));
    const wantR = (input.steer * maxYaw - this.yaw) * 11;
    const target = Math.max(-lock, Math.min(lock, (((wantR - this.r * 0.35) * L) / Math.max(speed, 4)) * 2));
    const rate = Math.max(lock / 0.06, 0.02); // full lock in 60 ms: the wheel answers the key at once
    this.delta += Math.max(-rate * dt, Math.min(rate * dt, target - this.delta));

    // --- loads on each axle, weight shifting with the last step's acceleration
    const W = s.mass * G;
    const shift = (s.mass * this.ax * s.cgHeight) / L;
    const Nf = Math.max(0.2 * W, W * s.cgFront - shift), Nr = Math.max(0.2 * W, W * (1 - s.cgFront) + shift);

    // --- tyre lateral forces: slip angle in, a saturating curve out
    const uu = Math.max(speed, 1.5);
    const alphaF = Math.atan2(this.v + a * this.r, uu) - this.delta;
    const alphaR = Math.atan2(this.v - b * this.r, uu);
    const tyre = (alpha: number, N: number) => {
      const peak = s.grip * SIDE_GRIP * N, k = s.corner * SIDE_GRIP * N;
      // a smooth saturation (Pacejka-like): linear at small slip, a plateau past the peak
      const x = (k * alpha) / peak;
      return -peak * Math.tanh(x) * (1 - 0.08 * Math.min(1, Math.abs(x) / 3));
    };
    const Fyf = tyre(alphaF, Nf), Fyr = tyre(alphaR, Nr);
    this.slipFront = Math.abs(s.corner * alphaF / s.grip);
    this.slipRear = Math.abs(s.corner * alphaR / s.grip);

    // --- drivetrain: rpm from the wheels, automatic shifts with a short cut
    const ratio = () => s.gears[this.gear - 1] * s.final;
    const wheelRpm = (speed / s.wheelRadius) * 30 / Math.PI;
    if (this.shifting > 0) this.shifting -= dt;
    else if (this.rpm > s.redline * 0.94 && this.gear < s.gears.length && this.throttle > 0.3) { this.gear++; this.shifting = SHIFT_TIME; }
    else if (this.gear > 1 && wheelRpm * s.gears[this.gear - 2] * s.final < s.redline * (this.throttle > 0.5 ? 0.78 : 0.55)) { this.gear--; this.shifting = SHIFT_TIME * 0.8; }
    const engineFree = s.idle + this.throttle * (s.redline - s.idle) * 0.4;
    const geared = wheelRpm * ratio();
    // below the clutch's bite the engine runs free toward a launch rpm
    const target_rpm = Math.max(geared, this.gear === 1 && speed < 6 ? Math.max(s.idle, engineFree) : s.idle);
    this.rpm += (Math.min(s.redline * 1.02, target_rpm) - this.rpm) * Math.min(1, dt * 18);
    const onPower = this.shifting <= 0 ? this.throttle : 0;
    let Fx = onPower * this.engineTorque(this.rpm) * ratio() * 0.88 / s.wheelRadius;
    if (this.rpm >= s.redline) Fx *= 0.2; // the limiter
    // the rear tyres can only push so hard, and less while they also corner
    const rearBudget = Math.sqrt(Math.max(0, Math.pow(s.grip * Nr, 2) - Fyr * Fyr));
    Fx = Math.min(Fx, rearBudget);
    // brakes, held at what the tyres allow (ABS)
    const brakeF = this.braking * s.brake * W * FEEL.brake * FEEL.pace;
    // engine braking off the throttle, drag, rolling
    const engineBrake = (1 - this.throttle) * (this.rpm / s.redline) * ratio() * 22 / s.wheelRadius;
    const resist = 0.5 * RHO * s.drag * speed * speed + CRR * W + engineBrake;
    const Flong = Fx - (speed > 0.05 ? brakeF + resist : 0);

    // --- Traffic Racer's control, as its code does it: the key sets how fast the car crosses the
    // road (about 8.5 m/s at 100 km/h, more as it goes faster), reached in a fifth of a second and
    // dropped as soon as the key is let go. The car points where it goes, so it yaws into a lane
    // change and straightens out of it; the body leans and the wheels steer to match. After a knock
    // the tyre model below takes over for a moment, so a hit still sends the car sliding.
    if (this.knocked > 0) this.knocked -= dt;
    if (this.knocked <= 0 && speed > 3) {
      // handling, 0 (a city car, stock) to 1 (the best car, fully upgraded): how fast it crosses, how hard
      // it may change direction, and how quickly the wheel answers
      const h = Math.max(0, Math.min(1, ((s.agility ?? 1.2) - 0.95) / 0.75));
      const ramp = dt / Math.max(0.01, FEEL.ramp * (1.2 - 0.5 * h));
      // flicking the other way goes straight through the middle, as hands on a wheel would
      if (input.steer * this.steer < 0) this.steer = 0;
      this.steer += Math.max(-ramp, Math.min(ramp, input.steer - this.steer));
      const lat = speed * Math.sin(this.yaw) + this.v * Math.cos(this.yaw); // sideways speed on the road
      const across = (5.5 + (speed / FEEL.pace) * 0.07) * (0.85 + 0.35 * h) * FEEL.across * FEEL.pace;
      // checking a slide the other way is twice as quick as building one
      const want = this.steer * across, reverse = (want - lat) * lat < 0;
      const aMax = (26 + 36 * h) * (reverse ? 1.9 : 1);
      const next = lat + Math.max(-aMax * dt, Math.min(aMax * dt, want - lat));
      const du = Flong / s.mass;
      const crawl = (FEEL.crawl / 3.6) * FEEL.pace;
      this.u = Math.max(Math.min(this.u, crawl), this.u + du * dt); // the brakes slow you to a crawl, never a stop
      const yaw = Math.asin(Math.max(-0.6, Math.min(0.6, next / Math.max(this.u, 1))));
      this.r = (yaw - this.yaw) / dt;
      this.yaw = yaw;
      this.v = 0;
      this.x += next * dt;
      this.z += this.u * Math.cos(yaw) * dt;
      this.ax += (du - this.ax) * Math.min(1, dt * 12);
      this.ay += ((next - lat) / dt - this.ay) * Math.min(1, dt * 12);
      this.delta = Math.max(-0.35, Math.min(0.35, Math.atan((L * this.r) / Math.max(this.u, 1)) * 2.5 + this.steer * 0.04));
      this.slipFront = this.slipRear = Math.abs(this.ay) / (4.5 * G); // the tyres only cry out on the most violent moves
      this.wheelSpin += (this.u / s.wheelRadius) * dt;
      return;
    }
    this.steer = input.steer;

    // --- integrate in the car's frame
    const cosD = Math.cos(this.delta);
    const du = Flong / s.mass + this.v * this.r;
    const dv = (Fyf * cosD + Fyr) / s.mass - this.u * this.r;
    const dr = (a * Fyf * cosD - b * Fyr) / Iz;
    this.u = Math.max(0, this.u + du * dt);
    this.v += dv * dt;
    this.r += dr * dt;
    // at a crawl the tyre model is stiff: let the kinematic model take over
    if (speed < 3) {
      const k = 1 - speed / 3;
      this.r += ((this.u * Math.tan(this.delta)) / L - this.r) * k;
      this.v *= 1 - k;
    }
    // stability control: a yaw rate past what the tyres can hold is braked back, as ESC would
    const rMax = (s.grip * SIDE_GRIP * G) / Math.max(uu, 4) * 1.1;
    if (Math.abs(this.r) > rMax) this.r += (Math.sign(this.r) * rMax - this.r) * Math.min(1, dt * 6);
    this.yaw += this.r * dt;
    const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    this.x += (this.u * sn + this.v * c) * dt;
    this.z += (this.u * c - this.v * sn) * dt;
    this.ax += (du - this.v * this.r - this.ax) * Math.min(1, dt * 12);
    this.ay += ((dv + this.u * this.r) - this.ay) * Math.min(1, dt * 12);
    this.wheelSpin += (this.u / s.wheelRadius) * dt;
  }
}
