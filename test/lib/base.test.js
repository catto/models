'use strict';
const assert = require('chai').assert;
const mockery = require('mockery');
const sinon = require('sinon');

sinon.assert.expose(assert, { prefix: '' });

describe('Base Model', () => {
    let BaseModel;
    let datastore;
    let schemaMock;
    let base;
    let config;
    let scmPlugin;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(() => {
        scmPlugin = {
            foo: 'foo'
        };
        datastore = {
            get: sinon.stub(),
            scan: sinon.stub(),
            update: sinon.stub()
        };

        schemaMock = {
            models: {
                base: {
                    tableName: 'base',
                    allKeys: ['id', 'foo', 'bar']
                }
            }
        };
        mockery.registerMock('screwdriver-data-schema', schemaMock);

        // eslint-disable-next-line global-require
        BaseModel = require('../../lib/base');

        config = {
            datastore,
            scmPlugin,
            id: 'as12345',
            foo: 'foo',
            bar: 'bar'
        };

        base = new BaseModel('base', config);
    });

    afterEach(() => {
        datastore = null;
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    describe('constructor', () => {
        it('constructs properly', () => {
            assert.instanceOf(base, BaseModel);
            schemaMock.models.base.allKeys.forEach(key => {
                assert.strictEqual(base[key], config[key]);
            });
            // datastore is private
            assert.isUndefined(base.datastore);
        });

        it('exposes as ownProperties only those keys defined in the schema', () => {
            assert.deepEqual(Object.getOwnPropertyNames(base), schemaMock.models.base.allKeys);
        });
    });

    describe('update', () => {
        it('is a noop if no fields changed', () => {
            assert.isFalse(base.isDirty());

            return base.update().then(model => {
                assert.isFalse(model.isDirty());
                assert.notCalled(datastore.update);
            });
        });

        it('promises to call datastore update', () => {
            datastore.update.yieldsAsync(null, { baseId: '1234' });

            base.foo = 'banana';
            assert.isTrue(base.isDirty());

            return base.update(config)
                .then(model => {
                    assert.deepEqual(model, base);
                    assert.isFalse(model.isDirty());
                    assert.isTrue(datastore.update.calledWith({
                        table: 'base',
                        params: {
                            id: 'as12345',
                            data: {
                                foo: 'banana'
                            }
                        }
                    }));
                });
        });

        it('rejects with a failure from the datastore update', () => {
            const errorMessage = 'iLessThanThreeMocha';

            datastore.update.yieldsAsync(new Error(errorMessage));
            // update won't call datastore unless values have changed
            base.foo = 'banana';

            return base.update(config)
                .then(() => {
                    assert.fail('this should not fail the test case');
                })
                .catch((err) => {
                    assert.strictEqual(err.message, errorMessage);
                });
        });
    });

    describe('isDirty', () => {
        it('returns true if is dirty', () => {
            assert.isFalse(base.isDirty());
            base.foo = 'banana';
            assert.equal(base.foo, 'banana');
            assert.isTrue(base.isDirty());
        });

        it('returns true if key is dirty', () => {
            assert.isFalse(base.isDirty('foo'));
            base.foo = 'banana';
            assert.equal(base.foo, 'banana');
            assert.isTrue(base.isDirty('foo'));
        });
    });

    describe('toString', () => {
        it('should give a string representation of the model', () => {
            assert.strictEqual(base.toString(), '{"id":"as12345","foo":"foo","bar":"bar"}');
        });
    });

    describe('toJson', () => {
        it('should give an object representation of the model data', () => {
            assert.deepEqual(base.toJson(), { id: 'as12345', foo: 'foo', bar: 'bar' });
        });
    });

    describe('scm', () => {
        it('should have a getter for the scm plugin', () => {
            assert.equal(base.scm, scmPlugin);
        });
    });
});
