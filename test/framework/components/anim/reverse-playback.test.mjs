import { expect } from 'chai';

import { INTERPOLATION_LINEAR } from '../../../../src/framework/anim/constants.js';
import { AnimCurve } from '../../../../src/framework/anim/evaluator/anim-curve.js';
import { AnimData } from '../../../../src/framework/anim/evaluator/anim-data.js';
import { AnimEvents } from '../../../../src/framework/anim/evaluator/anim-events.js';
import { AnimTrack } from '../../../../src/framework/anim/evaluator/anim-track.js';
import { Entity } from '../../../../src/framework/entity.js';
import { createApp } from '../../../app.mjs';
import { jsdomSetup, jsdomTeardown } from '../../../jsdom.mjs';

describe('AnimComponent reverse playback', function () {

    let app;

    beforeEach(function () {
        jsdomSetup();
        app = createApp();
    });

    afterEach(function () {
        app.destroy();
        app = null;
        jsdomTeardown();
    });

    // A one second track moving x from 0 to 10, with a single event at its midpoint. Each sample
    // below is taken every 0.3 seconds of playback.
    const duration = 1;
    const frame = 0.1;

    const createTrack = (events = new AnimEvents([{ name: 'half', time: 0.5 }])) => {
        const curve = new AnimCurve([{
            entityPath: ['model'],
            component: 'graph',
            propertyPath: ['localPosition']
        }], 0, 0, INTERPOLATION_LINEAR);
        const inputs = [new AnimData(1, [0, 1])];
        const outputs = [new AnimData(3, [0, 0, 0, 10, 0, 0])];
        return new AnimTrack('move', duration, inputs, outputs, [curve], events);
    };

    const createEntity = (componentSpeed, clipSpeed, loop, track = createTrack()) => {
        const entity = new Entity('model', app);
        app.root.addChild(entity);
        entity.addComponent('anim', { activate: true, speed: componentSpeed });
        entity.anim.assignAnimation('Move', track, undefined, clipSpeed, loop);
        return entity;
    };

    const run = (entity, frames = 24, sampleEvery = 3) => {
        let eventCount = 0;
        entity.anim.on('half', () => {
            eventCount++;
        });

        const samples = [];
        for (let i = 1; i <= frames; i++) {
            entity.anim.update(frame);
            if (i % sampleEvery === 0) {
                samples.push(Math.round(entity.localPosition.x));
            }
        }

        const layer = entity.anim.baseLayer;
        return {
            samples,
            eventCount,
            layerTime: layer.activeStateCurrentTime,
            clipTime: layer._controller.animEvaluator.clips[0].time,
            finalX: entity.localPosition.x
        };
    };

    // forwards and reverse sample sequences, starting from the start and the end respectively
    const forwardsSamples = [3, 6, 9, 2, 5, 8, 1, 4];
    const reverseSamples = [7, 4, 1, 8, 5, 2, 9, 6];

    describe('looping tracks', function () {

        it('plays forwards with positive component and clip speeds', function () {
            const result = run(createEntity(1, 1, true));
            expect(result.samples).to.deep.equal(forwardsSamples);
            expect(result.eventCount).to.equal(2);
            expect(result.layerTime).to.be.closeTo(2.4, 1e-9);
        });

        it('plays backwards when only the clip speed is negative', function () {
            const result = run(createEntity(1, -1, true));
            expect(result.samples).to.deep.equal(reverseSamples);
            expect(result.eventCount).to.equal(2);
            expect(result.layerTime).to.be.closeTo(-2.4, 1e-9);
        });

        it('plays backwards when only the component speed is negative', function () {
            const result = run(createEntity(-1, 1, true));
            expect(result.samples).to.deep.equal(reverseSamples);
            expect(result.eventCount).to.equal(2);
            expect(result.layerTime).to.be.closeTo(-2.4, 1e-9);
        });

        it('plays forwards when both component and clip speeds are negative', function () {
            const result = run(createEntity(-1, -1, true));
            expect(result.samples).to.deep.equal(forwardsSamples);
            expect(result.eventCount).to.equal(2);
            expect(result.layerTime).to.be.closeTo(2.4, 1e-9);
        });

        it('keeps moving when a reverse track loops back from the start to the end', function () {
            const entity = createEntity(-1, 1, true);
            entity.anim.update(1.5);
            // started at x=10 and moved backwards through the whole track, wrapping at the start
            expect(entity.localPosition.x).to.be.closeTo(5, 1e-9);
        });

        it('reverses a fractional clip speed the same way as a unit one', function () {
            // mirrors the animation/events example, where the track is assigned with speed 0.62
            const entity = createEntity(-1, 0.62, true);
            entity.anim.update(1);
            // component -1 with clip 0.62 plays backwards at 0.62x, so after one second the
            // cursor is 0.62 of the way from the end towards the start
            expect(entity.anim.baseLayer._controller.animEvaluator.clips[0].time).to.be.closeTo(0.38, 1e-9);
            expect(entity.localPosition.x).to.be.closeTo(3.8, 1e-9);
        });

    });

    describe('non looping tracks', function () {

        it('walks backwards to the start and stops when the clip speed is negative', function () {
            const result = run(createEntity(1, -1, false));
            expect(result.samples).to.deep.equal([7, 4, 1, 0, 0, 0, 0, 0]);
            expect(result.eventCount).to.equal(1);
            expect(result.finalX).to.equal(0);
            expect(result.clipTime).to.equal(0);
            expect(result.layerTime).to.be.closeTo(-duration, 1e-9);
        });

        it('walks backwards to the start and stops when the component speed is negative', function () {
            const result = run(createEntity(-1, 1, false));
            expect(result.samples).to.deep.equal([7, 4, 1, 0, 0, 0, 0, 0]);
            expect(result.eventCount).to.equal(1);
            expect(result.finalX).to.equal(0);
            expect(result.clipTime).to.equal(0);
            expect(result.layerTime).to.be.closeTo(-duration, 1e-9);
        });

    });

    describe('state progress and direction changes', function () {

        it('reports a reverse progress that grows from 0 towards 1', function () {
            const entity = createEntity(-1, 1, true);
            entity.anim.update(0.25);
            expect(entity.anim.baseLayer.activeStateProgress).to.be.closeTo(0.25, 1e-9);
            entity.anim.update(0.25);
            expect(entity.anim.baseLayer.activeStateProgress).to.be.closeTo(0.5, 1e-9);
        });

        it('reverses and re-aligns its events when the component speed changes sign', function () {
            const entity = createEntity(1, 1, true);
            // play forwards past the midpoint event once
            entity.anim.update(0.6);
            let forwardEvents = 0;
            entity.anim.on('half', () => {
                forwardEvents++;
            });
            expect(entity.localPosition.x).to.be.closeTo(6, 1e-9);

            // flip the component into reverse: the clip should now move backwards and the event
            // should fire again as it crosses the midpoint going the other way
            entity.anim.speed = -1;
            entity.anim.update(0.2);
            expect(entity.localPosition.x).to.be.closeTo(4, 1e-9);
            expect(forwardEvents).to.equal(1);
        });

    });

    describe('animation event ordering', function () {

        // mirrors the animation/events example: a right foot step at 10% of the duration and a
        // left foot step at 60%
        const footstepTrack = () => createTrack(new AnimEvents([
            { name: 'foot_step', time: 0.1, bone: 'right' },
            { name: 'foot_step', time: 0.6, bone: 'left' }
        ]));

        const collectBones = (entity, frames) => {
            const bones = [];
            entity.anim.on('foot_step', event => bones.push(event.bone));
            for (let i = 0; i < frames; i++) {
                entity.anim.update(frame);
            }
            return bones;
        };

        it('fires right then left while playing forwards', function () {
            const entity = createEntity(1, 1, true, footstepTrack());
            // a full pass over the track: right at 0.1s then left at 0.6s
            expect(collectBones(entity, 10)).to.deep.equal(['right', 'left']);
        });

        it('fires left then right while a negative component speed plays backwards', function () {
            const entity = createEntity(-1, 1, true, footstepTrack());
            // reverse playback starts at the end of the track and crosses the left step first
            expect(collectBones(entity, 10)).to.deep.equal(['left', 'right']);
        });

        it('fires left then right while a negative clip speed plays backwards', function () {
            const entity = createEntity(1, -1, true, footstepTrack());
            expect(collectBones(entity, 10)).to.deep.equal(['left', 'right']);
        });

        it('fires right then left when both component and clip speeds are negative', function () {
            const entity = createEntity(-1, -1, true, footstepTrack());
            expect(collectBones(entity, 10)).to.deep.equal(['right', 'left']);
        });

    });
});
