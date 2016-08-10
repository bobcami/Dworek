/******************************************************************************
 * Copyright (c) Dworek 2016. All rights reserved.                            *
 *                                                                            *
 * @author Tim Visee                                                          *
 * @website http://timvisee.com/                                              *
 *                                                                            *
 * Open Source != No Copyright                                                *
 *                                                                            *
 * Permission is hereby granted, free of charge, to any person obtaining a    *
 * copy of this software and associated documentation files (the "Software"), *
 * to deal in the Software without restriction, including without limitation  *
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,   *
 * and/or sell copies of the Software, and to permit persons to whom the      *
 * Software is furnished to do so, subject to the following conditions:       *
 *                                                                            *
 * The above copyright notice and this permission notice shall be included    *
 * in all copies or substantial portions of the Software.                     *
 *                                                                            *
 * You should have received a copy of The MIT License (MIT) along with this   *
 * program. If not, see <http://opensource.org/licenses/MIT/>.                *
 ******************************************************************************/

var util = require('util');
var async = require('async');
var _ = require('lodash');

var SmartCallback = require('../util/SmartCallback');
var ObjectCache = require('../cache/ObjectCache');
var MongoUtils = require('../mongo/MongoUtils');
var RedisUtils = require('../redis/RedisUtils');

/**
 * Time in seconds for a cached field to expire.
 * @type {number} Time in seconds.
 */
const CACHE_FIELD_EXPIRE = 60;

/**
 * Cache key prefix for database object layer instances.
 *
 * @type {string}
 */
const CACHE_KEY_PREFIX = 'model:';

/**
 * Constructor.
 *
 * @class
 * @constructor
 *
 * @param {Object} instance Model object instance.
 * @param {Object} modelConfig Field configuration for this object.
 */
var BaseModel = function(instance, modelConfig) {
    // Store the model instance
    /**
     * Model object instance.
     *
     * @type {Object}
     */
    this._instance = instance;

    // Store the model configuration
    /**
     * Model configuration.
     *
     * @type {Object} Model configuration.
     */
    this._modelConfig = modelConfig;

    // Configure the local object cache
    /**
     * Local object cache.
     *
     * @type {ObjectCache}
     */
    this._cache = new ObjectCache();
};

/**
 * Get a field from MongoDB.
 *
 * @param {String} field Name of the field.
 * @param {BaseModel~mongoGetFieldCallback} callback Called when the data is fetched from MongoDB, or when an error occurred.
 */
BaseModel.prototype.mongoGetField = function(field, callback) {
    // Get the MongoDB connection instance
    const mongo = MongoUtils.getConnection();

    // Store the class instance
    const instance = this;

    // Get the MongoDB field name
    var mongoField = field;
    if(_.has(this._modelConfig.fields, field + '.mongo.field'))
        mongoField = this._modelConfig.fields[field].mongo.field || field;

    // Create the query object
    var queryObject = {
        _id: this._instance.getId()
    };

    // Create the projection object
    var projectionObject = {};
    projectionObject[mongoField] = true;

    // Fetch the field from MongoDB
    mongo.collection(this._modelConfig.db.collection).find(queryObject, projectionObject).toArray(function(err, reply) {
        // Call back errors
        if(err !== null) {
            callback(new Error(err), undefined);
            return;
        }

        // Call back undefined if no results were found
        if(reply.length === 0) {
            callback(null, undefined);
            return;
        }

        // Get the value
        var value = reply[0][mongoField];

        // Check whether a conversion function is configured
        var hasConversionFunction = _.has(instance._modelConfig.fields, field + '.mongo.from');

        // Convert the value
        if(hasConversionFunction) {
            // Get the conversion function
            var conversionFunction = instance._modelConfig.fields[field].mongo.from;

            // Convert the value
            value = conversionFunction(value);
        }

        // Call back with the result
        callback(null, value);
    });
};

/**
 * Called when the data is fetched from MongoDB, or when an error occurred.
 *
 * @callback BaseModel~mongoGetFieldCallback
 * @param {Error|null} Error instance if an error occurred, null on success.
 * @param {*} Fetched field value.
 */

/**
 * Get a list of fields from MongoDB.
 *
 * @param {Array} fields Array of field names to get.
 * @param {BaseModel~mongoGetFieldsCallback} callback Called when the data is fetched from MongoDB, or when an error occurred.
 */
BaseModel.prototype.mongoGetFields = function(fields, callback) {
    // Get the MongoDB connection instance
    const mongo = MongoUtils.getConnection();

    // Store the class instance
    const instance = this;

    // Create a list of field name translations to MongoDB
    var mongoFields = {};
    fields.forEach(function(field) {
        // Get the MongoDB field name and add it to the array, use the field name if nothing is configured
        if(_.has(instance._modelConfig.fields, fields + '.mongo.field'))
            mongoFields[field] = instance._modelConfig.fields[fields].mongo.field || fields;
        else
            mongoFields[field] = field;
    });

    // Create the query object
    var queryObject = {
        _id: this._instance.getId()
    };

    // Create the projection object
    var projectionObject = {};
    for(var field in mongoFields)
        projectionObject[mongoFields[field]] = true;

    // Create a results object
    var results = {};

    // Fetch the field from MongoDB
    mongo.collection(this._modelConfig.db.collection).find(queryObject, projectionObject).toArray(function(err, reply) {
        // Call back errors
        if(err !== null) {
            callback(new Error(err), undefined);
            return;
        }

        // Call back undefined if no results were found
        if(reply.length === 0) {
            callback(null, undefined);
            return;
        }

        // Get the data object
        var data = reply[0];

        // Loop through the fields, convert it's values and add it to the result object
        for(var field in mongoFields) {
            // Get the value for the mongo field
            var value = data[mongoFields[field]];

            // Check whether a conversion function is configured
            var hasConversionFunction = _.has(instance._modelConfig.fields, fields + '.mongo.from');

            // Convert the value
            if(hasConversionFunction) {
                // Get the conversion function
                var conversionFunction = instance._modelConfig.fields[fields].mongo.from;

                // Convert the value
                value = conversionFunction(value);
            }

            // Add the value to the results object
            results[field] = value;
        }

        // Call back with the result
        callback(null, results);
    });
};

/**
 * Called when the data is fetched from MongoDB, or when an error occurred.
 *
 * @callback BaseModel~mongoGetFieldsCallback
 * @param {Error|null} Error instance if an error occurred, null on success.
 * @param {Object} Object with field values.
 */

/**
 * Set a field in MongoDB.
 *
 * @param {String} field Name of the field.
 * @param {*} value Field value.
 * @param {BaseModel~mongoSetFieldCallback} callback Called when the value is set, or if an error occurred.
 */
BaseModel.prototype.mongoSetField = function(field, value, callback) {
    // Get the MongoDB connection instance
    const mongo = MongoUtils.getConnection();

    // Check whether a conversion function is configured
    var hasConversionFunction = _.has(this._modelConfig.fields, field + '.mongo.to');

    // Convert the value
    if(hasConversionFunction) {
        // Get the conversion function
        var conversionFunction = this._modelConfig.fields[field].mongo.to;

        // Convert the value
        value = conversionFunction(value);
    }

    // Get the MongoDB field name
    var mongoField = field;
    if(_.has(this._modelConfig.fields, field + '.mongo.field'))
        mongoField = this._modelConfig.fields[field].mongo.field || field;

    // Create the query object
    var queryObject = {
        _id: this._instance.getId()
    };

    // Create the update object
    var updateObject = {
        $set: {}
    };
    updateObject.$set[mongoField] = value;

    // Fetch the field from MongoDB
    mongo.collection(this._modelConfig.db.collection).updateOne(queryObject, updateObject).toArray(function(err) {
        // Call back errors
        if(err !== null) {
            callback(new Error(err));
            return;
        }

        // Call back with success
        callback(null);
    });
};

/**
 * Called when the value is set, or if an error occurred.
 *
 * @callback BaseModel~mongoSetFieldCallback
 * @param {Error|null} Error instance if an error occurred, null on success.
 */

/**
 * Set a list of fields in MongoDB.
 *
 * @param {Object} fields Object with fields and values to set.
 * @param {BaseModel~mongoSetFieldsCallback} callback Called when the values are set, or when an error occurred.
 */
BaseModel.prototype.mongoSetFields = function(fields, callback) {
    // Get the MongoDB connection instance
    const mongo = MongoUtils.getConnection();

    // Create a data object
    var data = {};

    // Loop through the fields, convert them to MongoDB fields and convert their values
    for(var field in fields) {
        // Get the MongoDB field name
        var mongoField = field;
        if(_.has(this._modelConfig.fields, field + '.mongo.field'))
            mongoField = this._modelConfig.fields[field].mongo.field || field;

        // Check whether a conversion function is configured
        var hasConversionFunction = _.has(this._modelConfig.fields, field + '.mongo.to');

        // Get the value
        var value = fields[field];

        // Convert the value
        if(hasConversionFunction) {
            // Get the conversion function
            var conversionFunction = this._modelConfig.fields[field].mongo.to;

            // Convert the value
            value = conversionFunction(value);
        }

        // Add the value to the data object
        data[mongoField] = value;
    }

    // Create the query object
    var queryObject = {
        _id: this._instance.getId()
    };

    // Create the update object
    var updateObject = {
        $set: data
    };

    // Fetch the field from MongoDB
    mongo.collection(this._modelConfig.db.collection).updateOne(queryObject, updateObject).toArray(function(err) {
        // Call back errors
        if(err !== null) {
            callback(new Error(err));
            return;
        }

        // Call back with success
        callback(null);
    });
};

/**
 * Called when the value is set, or if an error occurred.
 *
 * @callback BaseModel~mongoSetFieldsCallback
 * @param {Error|null} Error instance if an error occurred, null on success.
 */

/**
 * TODO: Untested function.
 *
 * Check whether the given field is in MongoDB.
 *
 * @param {String} field Field name.
 * @param {BaseModel~mongoHasFieldCallback} callback Called with the result, or when an error occurred.
 */
BaseModel.prototype.mongoHasField = function(field, callback) {
    // Get the MongoDB connection instance
    const mongo = MongoUtils.getConnection();

    // Get the MongoDB field name
    var mongoField = field;
    if(_.has(this._modelConfig.fields, field + '.mongo.field'))
        mongoField = this._modelConfig.fields[field].mongo.field || field;

    // Create the query object
    var queryObject = {
        _id: this._instance.getId()
    };
    queryObject[mongoField] = {
        $exists: true
    };

    // Create the projection object
    var projectionObject = {
        _id: true
    };

    // Fetch the field from MongoDB
    mongo.collection(this._modelConfig.db.collection).find(queryObject, projectionObject).toArray(function(err, data) {
        // Call back errors
        if(err !== null) {
            callback(new Error(err), false);
            return;
        }

        // Determine and return the result
        callback(null, data.length > 0);
    });
};

/**
 * Called with the result, or when an error occurred.
 *
 * @callback BaseModel~mongoHasFieldCallback
 * @param {Error|null} Error instance if an error occurred, null otherwise.
 * @param {boolean} True if the field exists, false if not.
 */

/**
 * TODO: Untested function.
 *
 * Check whether the given fields are in MongoDB.
 *
 * @param {Array} fields List of field names.
 * @param {BaseModel~mongoHasFieldsCallback} callback Called with the result, or when an error occurred.
 */
BaseModel.prototype.mongoHasFields = function(fields, callback) {
    // Get the MongoDB connection instance
    const mongo = MongoUtils.getConnection();

    // Store the current instance
    const instance = this;

    // Create a list of field name translations to MongoDB
    var mongoFields = {};
    fields.forEach(function(field) {
        // Get the MongoDB field name and add it to the array, use the field name if nothing is configured
        if(_.has(instance._modelConfig.fields, fields + '.mongo.field'))
            mongoFields[field] = instance._modelConfig.fields[fields].mongo.field || fields;
        else
            mongoFields[field] = field;
    });

    // Create the query object
    var queryObject = {
        _id: this._instance.getId()
    };

    // Add the fields to the query object
    for(var field in mongoFields)
        queryObject[mongoFields[field]] = {
            $exists: true
        };

    // Create the projection object
    var projectionObject = {
        _id: true
    };

    // Fetch the field from MongoDB
    mongo.collection(this._modelConfig.db.collection).find(queryObject, projectionObject).toArray(function(err, data) {
        // Call back errors
        if(err !== null) {
            callback(new Error(err), false);
            return;
        }

        // Determine and return the result
        callback(null, data.length > 0);
    });
};

/**
 * Called with the result, or when an error occurred.
 *
 * @callback BaseModel~mongoHasFieldsCallback
 * @param {Error|null} Error instance if an error occurred, null otherwise.
 * @param {boolean} True if all the fields exist in MongoDB, false otherwise.
 */

/**
 * TODO: Untested function.
 *
 * Flush fields from MongoDB.
 * If field names are given, only those specific fields are flushed if they exists.
 *
 * @param {Array|String} [fields=undefined] Array of field names or name of the field to flush, undefined to flush all the fields.
 * @param {BaseModel~mongoFlushCallback} callback Called on success, or when an error occurred.
 */
BaseModel.prototype.mongoFlush = function(fields, callback) {
    // Get the MongoDB connection instance
    const mongo = MongoUtils.getConnection();

    // Create the query object
    var queryObject = {
        _id: this._instance.getId()
    };

    // Check whether to delete the whole document for this model object
    if(fields === undefined || (Array.isArray(fields) && fields.length === 0)) {
        // Delete the document
        // Delete the document from MongoDB
        mongo.collection(this._modelConfig.db.collection).deleteOne(queryObject, function(err) {
            // Call back errors
            if(err !== null) {
                callback(new Error(err));
                return;
            }

            // Call back with success
            callback(null);
        });

        return;
    }

    // Delete a specific field
    // Convert the fields to an array if it's a string
    fields = [fields];

    // Store this instance
    const instance = this;

    // Create a list of field name translations to MongoDB
    var mongoFields = {};
    fields.forEach(function(field) {
        // Get the MongoDB field name and add it to the array, use the field name if nothing is configured
        if(_.has(instance._modelConfig.fields, fields + '.mongo.field'))
            mongoFields[field] = instance._modelConfig.fields[fields].mongo.field || fields;
        else
            mongoFields[field] = field;
    });

    // Create an object of fields to update
    var updateFieldsObject = {};
    for(var field in mongoFields)
        updateFieldsObject[mongoFields[field]] = '';

    // Create the update object
    var updateObject = {
        $unset: updateFieldsObject
    };

    // Delete the field from MongoDB
    mongo.collection(this._modelConfig.db.collection).updateOne(queryObject, updateObject, function(err) {
        // Call back errors
        if(err !== null) {
            callback(new Error(err));
            return;
        }

        // Call back with success
        callback(null);
    });
};

/**
 * Called on success, or when an error occurred.
 *
 * @callback BaseModel~mongoFlushCallback
 * @param {Error|null} Error instance if an error occurred, null on success.
 */

/**
 * Check whether cache for the given field is enabled.
 *
 * @param {string} field Field name.
 *
 * @return {boolean} True if enabled, false if not.
 */
BaseModel.prototype.cacheIsFieldEnabled = function(field) {
    // If configured, return whether cache is enabled
    if(_.has(this._modelConfig.fields, field + '.cache.enable'))
        return this._modelConfig.fields[field].cache.enable;

    // Cache not configured, return the default
    return true;
};

/**
 * Check whether cache is enabled for the given fields.
 *
 * @param {Array|String} fields Array of field names, or a single field name as a string.
 *
 * @return {boolean} True if all fields are enabled, false otherwise.
 */
BaseModel.prototype.cacheAreFieldsEnabled = function(fields) {
    // Convert the fields parameter to an array if it isn't an array
    if(!Array.isArray(fields))
        fields = [fields];

    // Loop through all the fields, check whether cache is enabled
    for(var i = 0, fieldCount = fields.length; i < fieldCount; i++) {
        // Get the current field
        var field = fields[i];

        // Cache must be enabled for this field, if it's configured. Return false if that's not the case
        if(_.has(this._modelConfig.fields, field + '.cache.enable') && !this._modelConfig.fields[field].cache.enable)
            return false;
    }

    // Cache seems to be enabled for all fields, return true
    return true;
};

/**
 * Get a field from cache.
 *
 * @param {String} field Name of the field.
 *
 * @return {*} Field value, undefined is returned the field isn't cached.
 */
BaseModel.prototype.cacheGetField = function(field) {
    // Return undefined if cache is disabled for this field
    if(!this.cacheIsFieldEnabled(field))
        return undefined;

    // Get the field from cache
    var value = this._cache.getCache(field);

    // Check whether a conversion function is configured
    var hasConversionFunction = _.has(this._modelConfig.fields, field + '.cache.from');

    // Convert the value
    if(hasConversionFunction) {
        // Get the conversion function
        var conversionFunction = this._modelConfig.fields[field].cache.from;

        // Convert the value
        value = conversionFunction(value);
    }

    // Return the result value
    return value;
};

/**
 * Get a list of fields from cache.
 *
 * @param {Array} fields List of the field names to get from cache.
 *
 * @return {Object} Object with the fields and values.
 * Values will be undefined if they aren't available in cache or if cache is disabled for that specific field.
 */
BaseModel.prototype.cacheGetFields = function(fields) {
    // Create a results object
    var results = {};

    // Loop through all the fields, fetch and convert their value and add it to the results object
    fields.forEach(function(field) {
        // Set the value to undefined if cache isn't enabled for this field
        if(!this.cacheIsFieldEnabled(field)) {
            results[field] = undefined;
            return;
        }

        // Get the field from cache
        var value = this._cache.getCache(field);

        // Check whether a conversion function is configured
        var hasConversionFunction = _.has(this._modelConfig.fields, field + '.cache.from');

        // Convert the value
        if(hasConversionFunction) {
            // Get the conversion function
            var conversionFunction = this._modelConfig.fields[field].cache.from;

            // Convert the value
            value = conversionFunction(value);
        }

        // Add the value to the results object
        results[field] = value;
    });

    // Return the result object
    return results;
};

/**
 * Set a field in cache.
 * If cache is disabled for this field, the function will return immediately without actually storing the value in cache.
 *
 * @param {String} field Name of the field.
 * @param {*} value Field value.
 */
BaseModel.prototype.cacheSetField = function(field, value) {
    // Return if cache is disabled for this field
    if(!this.cacheIsFieldEnabled(field))
        return;

    // Check whether a conversion function is configured
    var hasConversionFunction = _.has(this._modelConfig.fields, field + '.cache.to');

    // Convert the value
    if(hasConversionFunction) {
        // Get the conversion function
        var conversionFunction = this._modelConfig.fields[field].cache.to;

        // Convert the value
        value = conversionFunction(value);
    }

    // Set the cache
    this._cache.setCache(field, value);
};

/**
 * Check whether the given field is cached.
 *
 * @param {String} field Field name.
 *
 * @return {boolean} True if the field is cached, false if not.
 */
BaseModel.prototype.cacheHasField = function(field) {
    // Return false if cache isn't enabled for this field
    if(!this.cacheIsFieldEnabled(field))
        return false;

    // Check whether this field is cached, return the result
    return this._cache.cacheHasField(field);
};

/**
 * Flush the cached fields.
 * If a field name is given, only that specific field is flushed if it exists.
 *
 * @param {String} [field=undefined] Name of the field to flush, undefined to flush all cache.
 */
BaseModel.prototype.cacheFlush = function(field) {
    this._cache.cacheFlush(field);
};

/**
 * Check whether Redis for the given field is enabled.
 *
 * @param {string} field Field name.
 *
 * @return {boolean} True if enabled, false if not.
 */
BaseModel.prototype.redisIsFieldEnabled = function(field) {
    // If configured, return whether cache is enabled
    if(_.has(this._modelConfig.fields, field + '.redis.enable'))
        return this._modelConfig.fields[field].redis.enable;

    // Redis not configured, return the default
    return true;
};

/**
 * Get the Redis root key for this model.
 *
 * @return {string} Redis root key.
 */
BaseModel.prototype.redisGetKeyRoot = function() {
    // TODO: Use the model type name here, instead of the database collection name
    return CACHE_KEY_PREFIX + this._modelConfig.db.collection + ':' + this._instance.getIdHex();
};

/**
 * Get the Redis key for the given field.
 *
 * @param {string} field Name of the field.
 *
s * @return {string} Redis key for the given field.
 */
BaseModel.prototype.redisGetKey = function(field) {
    return this.redisGetKeyRoot() + ':' + field;
};

/**
 * Get a field from Redis.
 *
 * @param {String} field Name of the field.
 * @param {BaseModel~redisGetFieldCallback} callback Called when the value is fetched, or when an error occurred.
 */
BaseModel.prototype.redisGetField = function(field, callback) {
    // Return undefined if Redis is disabled for this field
    if(!this.redisIsFieldEnabled(field)) {
        callback(null, undefined);
        return;
    }

    // Get the Redis key
    var key = this.redisGetKey(field);

    // Get the Redis connection instance
    const redis = RedisUtils.getConnection();

    // Store the class instance
    const instance = this;

    // Fetch the value from Redis
    redis.get(key, function(err, value) {
        // Handle errors
        // TODO: Is it possible to only check for null, and not for undefined?
        if(err !== undefined && err !== null) {
            // Print the error to the console
            console.warn('Redis error: ' + err);

            // Route the error
            callback(err);
            return;
        }

        // Call back if the value is null
        if(value === null) {
            callback(null, value);
            return;
        }

        // Check whether a conversion function is configured
        var hasConversionFunction = _.has(instance._modelConfig.fields, field + '.redis.from');

        // Convert the value
        if(hasConversionFunction) {
            // Get the conversion function
            var conversionFunction = instance._modelConfig.fields[field].redis.from;

            // Convert the value
            value = conversionFunction(value);
        }

        // Call back the value
        callback(null, value);
    });
};

/**
 * Called when a field value is fetched from Redis, or if an error occurred.
 *
 * @callback BaseModel~redisGetFieldCallback
 * @param {Error|null} Error instance if an error occurred, null on success.
 * @param {*} Field value, or undefined if failed to fetch the field.
 */

/**
 * Set a field value in Redis.
 * The field won't be set if Redis is disabled for this field, the success callback is called in that case.
 *
 * @param {string} field Name of the field.
 * @param {*} value Value of the field.
 * @param {BaseModel~redisSetFieldCallback} callback Called when the value is set, or when an error occurred.
 */
BaseModel.prototype.redisSetField = function(field, value, callback) {
    // Return undefined if Redis is disabled for this field
    if(!this.redisIsFieldEnabled(field)) {
        callback(null);
        return;
    }

    // Get the Redis key
    var key = this.redisGetKey(field);

    // Get the Redis connection instance
    const redis = RedisUtils.getConnection();

    // Check whether a conversion function is configured
    var hasConversionFunction = _.has(this._modelConfig.fields, field + '.redis.to');

    // Convert the value
    if(hasConversionFunction) {
        // Get the conversion function
        var conversionFunction = this._modelConfig.fields[field].redis.to;

        // Convert the value
        value = conversionFunction(value);
    }

    // Set the value
    redis.set(key, value, function(err) {
        // Call back if an error occurred
        if(err !== null) {
            callback(err);
            return;
        }

        // Configure the expiration time of the field in Redis
        //noinspection JSValidateTypes
        redis.expire(key, CACHE_FIELD_EXPIRE, (err) => callback(err));
    });
};

/**
 * Check whether the given field is available in Redis.
 *
 * @param {String} field Name of the field.
 * @param {BaseModel~redisHasFieldCallback} callback Called with the result, or when an error occurred.
 *
 * @return {boolean} True if the field is in Redis, false if not.
 */
BaseModel.prototype.redisHasField = function(field, callback) {
    // Return false if Redis isn't enabled for this field
    if(!this.redisIsFieldEnabled(field))
        return false;

    // Get the Redis key
    var key = this.redisGetKey(field);

    // Get the Redis connection instance
    var redis = RedisUtils.getConnection();

    // Check whether the field is available in Redis
    redis.exists(key, function(err, reply) {
        // Call back if an error occurred
        if(err !== null) {
            callback(err);
            return;
        }

        // Call back with the result
        callback(null, reply === 1);
    });
};

/**
 * Called with the result, or when an error occurred.
 *
 * @callback BaseModel~redisHasFieldCallback
 * @param {Error|null} Error instance if an error occurred, null otherwise.
 * @param {boolean=} The result, true if Redis has the field, false if not.
 */

/**
 * Flush the fields from Redis.
 * If a field name is given, only that specific field is flushed if it exists.
 *
 * @param {String} [field=undefined] Name of the field to flush, undefined to flush all fields in Redis.
 * @param {BaseModel~redisFlushCallback} callback Called when the fields are flushed, or when an error occurred.
 */
BaseModel.prototype.redisFlush = function(field, callback) {
    // Get the Redis instance
    var redis = RedisUtils.getConnection();

    // Create a latch
    var latch = new SmartCallback();

    // Create an array of keys to delete
    var keys = [];

    // Add a latch to fetch the list of keys to delete
    latch.add();

    // Flush a specific field if a field is given
    if(field !== undefined && field !== null) {
        // Get the Redis key, and put it in the keys array
        keys.push(this.redisGetKey(field));

        // Resolve the latch
        latch.resolve();

    } else {
        // Get the base wildcard key for this model object
        var baseWildcardKey = this.redisGetKeyRoot() + ':*';

        // Fetch all keys for this model object
        redis.keys(baseWildcardKey, function(err, replyKeys) {
            // Call back if an error occurred
            if(err !== null) {
                callback(null, 0);
                return;
            }

            // Add the fetched keys to the keys array
            keys.concat(replyKeys);

            // Resolve the latch
            latch.resolve();
        });
    }

    // Delete the keys after the keys that have to be deleted are fetched
    latch.then(function() {
        // Call back if there are no keys to delete
        if(keys.length === 0) {
            callback(null, 0);
            return;
        }

        // Delete the keys from Redis
        redis.del(keys, function(err, reply) {
            // Call back if an error occurred
            if(err !== null) {
                callback(err, 0);
                return;
            }

            // Call back with the result
            callback(null, reply);
        });
    });
};

/**
 * Called when the fields are flushed, or when an error occurred.
 *
 * @callback BaseModel~redisFlushCallback
 * @param {Error|null} Error instance if an error occurred, null on success.
 * @param {Number} Number of keys that were deleted from Redis.
 */

/**
 * Called when the value is set, or when an error occurred.
 *
 * @callback BaseModel~redisSetFieldCallback
 * @param {Error|null} Error instance if an error occurred, null on success.
 */

// Export the class
module.exports = BaseModel;
