(module
 (type $0 (func (param i32 i32 i32 i32) (result i32)))
 (import "env" "memory" (memory $0 1 1024))
 (global $assembly/fl-logistic/abi_version i32 (i32.const 1))
 (export "abi_version" (global $assembly/fl-logistic/abi_version))
 (export "run" (func $assembly/fl-logistic/run))
 (export "memory" (memory $0))
 (func $assembly/fl-logistic/run (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (result i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i64)
  (local $11 i64)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (local $18 i32)
  (local $19 i32)
  (local $20 i32)
  (local $21 i32)
  (local $22 i32)
  (local $23 i64)
  local.get $1
  i32.const 0
  i32.le_s
  local.get $1
  i32.const 1048576
  i32.gt_s
  i32.or
  if
   i32.const 1
   return
  end
  local.get $2
  i32.const 0
  i32.le_s
  local.get $2
  i32.const 4096
  i32.gt_s
  i32.or
  if
   i32.const 2
   return
  end
  local.get $0
  i32.load offset=8
  local.set $16
  local.get $0
  i32.load offset=12
  local.set $12
  local.get $0
  i32.load offset=16
  local.set $17
  local.get $0
  i32.load offset=20
  local.tee $8
  i32.const 2
  i32.lt_s
  local.get $0
  i32.load
  local.tee $13
  local.get $0
  i32.load offset=4
  local.tee $18
  i32.ge_s
  i32.or
  if
   i32.const 3
   return
  end
  local.get $3
  local.get $2
  i32.const 2
  i32.shl
  i32.const 12
  i32.add
  local.get $0
  i32.add
  i32.lt_s
  local.get $3
  local.get $0
  i32.const 32
  i32.add
  local.tee $7
  local.get $8
  i32.const 2
  i32.shl
  i32.add
  local.tee $19
  local.get $1
  local.get $2
  i32.mul
  i32.const 2
  i32.shl
  i32.add
  local.tee $14
  local.get $1
  i32.const 2
  i32.shl
  i32.add
  i32.const 7
  i32.add
  i32.const -8
  i32.and
  local.tee $9
  local.get $2
  i32.const 3
  i32.shl
  i32.add
  i32.lt_s
  i32.or
  if
   i32.const 4
   return
  end
  i32.const 0
  local.set $0
  loop $for-loop|0
   local.get $0
   local.get $2
   i32.lt_s
   if
    local.get $3
    local.get $0
    i32.const 2
    i32.shl
    i32.add
    i32.const 0
    i32.store
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|0
   end
  end
  loop $for-loop|1
   local.get $15
   local.get $16
   i32.lt_s
   if
    block $for-break1
     i32.const 0
     local.set $0
     loop $for-loop|2
      local.get $0
      local.get $2
      i32.lt_s
      if
       local.get $9
       local.get $0
       i32.const 3
       i32.shl
       i32.add
       i64.const 0
       i64.store
       local.get $0
       i32.const 1
       i32.add
       local.set $0
       br $for-loop|2
      end
     end
     i64.const 0
     local.set $10
     i32.const 0
     local.set $6
     loop $for-loop|3
      local.get $1
      local.get $6
      i32.gt_s
      if
       local.get $19
       local.get $2
       local.get $6
       i32.mul
       i32.const 2
       i32.shl
       i32.add
       local.set $20
       local.get $5
       local.set $4
       i32.const 0
       local.set $0
       loop $for-loop|4
        local.get $0
        local.get $2
        i32.lt_s
        if
         local.get $0
         i32.const 2
         i32.shl
         local.tee $21
         local.get $20
         i32.add
         i32.load
         local.tee $22
         if
          local.get $4
          local.get $3
          local.get $21
          i32.add
          i64.load32_s
          local.get $22
          i64.extend_i32_s
          i64.mul
          i64.const 65536
          i64.div_s
          i32.wrap_i64
          i32.add
          local.set $4
         end
         local.get $0
         i32.const 1
         i32.add
         local.set $0
         br $for-loop|4
        end
       end
       block $__inlined_func$assembly/fl-logistic/sigmoidQ$1 (result i32)
        local.get $4
        local.get $13
        i32.sub
        local.tee $0
        i32.const 0
        i32.le_s
        if
         local.get $7
         i32.load
         br $__inlined_func$assembly/fl-logistic/sigmoidQ$1
        end
        local.get $0
        local.get $18
        local.get $13
        i32.sub
        local.tee $4
        i32.ge_s
        if
         local.get $7
         local.get $8
         i32.const 1
         i32.sub
         i32.const 2
         i32.shl
         i32.add
         i32.load
         br $__inlined_func$assembly/fl-logistic/sigmoidQ$1
        end
        local.get $7
        local.get $0
        i64.extend_i32_s
        local.get $8
        i32.const 1
        i32.sub
        i64.extend_i32_s
        i64.mul
        local.tee $23
        local.get $4
        i64.extend_i32_s
        local.tee $11
        i64.div_s
        i32.wrap_i64
        local.tee $0
        i32.const 2
        i32.shl
        i32.add
        i64.load32_s
        local.get $11
        local.get $23
        local.get $0
        i64.extend_i32_s
        local.get $11
        i64.mul
        i64.sub
        local.tee $23
        i64.sub
        i64.mul
        local.get $7
        local.get $0
        i32.const 1
        i32.add
        i32.const 2
        i32.shl
        i32.add
        i64.load32_s
        local.get $23
        i64.mul
        i64.add
        local.get $11
        i64.div_s
        i32.wrap_i64
       end
       i32.const 65536
       i32.const 0
       local.get $14
       local.get $6
       i32.const 2
       i32.shl
       i32.add
       i32.load
       select
       i32.sub
       local.set $4
       i32.const 0
       local.set $0
       loop $for-loop|5
        local.get $0
        local.get $2
        i32.lt_s
        if
         local.get $20
         local.get $0
         i32.const 2
         i32.shl
         i32.add
         i32.load
         local.tee $21
         if
          local.get $9
          local.get $0
          i32.const 3
          i32.shl
          i32.add
          local.tee $22
          local.get $22
          i64.load
          local.get $4
          i64.extend_i32_s
          local.get $21
          i64.extend_i32_s
          i64.mul
          i64.const 65536
          i64.div_s
          i64.add
          i64.store
         end
         local.get $0
         i32.const 1
         i32.add
         local.set $0
         br $for-loop|5
        end
       end
       local.get $10
       local.get $4
       i64.extend_i32_s
       i64.add
       local.set $10
       local.get $6
       i32.const 1
       i32.add
       local.set $6
       br $for-loop|3
      end
     end
     i32.const 0
     local.set $0
     i32.const 0
     local.set $6
     loop $for-loop|6
      local.get $2
      local.get $6
      i32.gt_s
      if
       local.get $12
       i64.extend_i32_s
       local.get $9
       local.get $6
       i32.const 3
       i32.shl
       i32.add
       i64.load
       local.get $1
       i64.extend_i32_s
       i64.div_s
       i32.wrap_i64
       local.get $3
       local.get $6
       i32.const 2
       i32.shl
       i32.add
       local.tee $4
       i64.load32_s
       local.get $17
       i64.extend_i32_s
       i64.mul
       i64.const 65536
       i64.div_s
       i32.wrap_i64
       i32.add
       i64.extend_i32_s
       i64.mul
       i64.const 65536
       i64.div_s
       i32.wrap_i64
       local.set $20
       local.get $4
       local.get $4
       i32.load
       local.get $20
       i32.sub
       i32.store
       i32.const 0
       local.get $20
       i32.sub
       local.get $20
       local.get $20
       i32.const 0
       i32.lt_s
       select
       local.tee $4
       local.get $0
       i32.gt_s
       if
        local.get $4
        local.set $0
       end
       local.get $6
       i32.const 1
       i32.add
       local.set $6
       br $for-loop|6
      end
     end
     local.get $5
     local.get $12
     i64.extend_i32_s
     local.get $10
     local.get $1
     i64.extend_i32_s
     i64.div_s
     i64.extend32_s
     i64.mul
     i64.const 65536
     i64.div_s
     i32.wrap_i64
     local.tee $4
     i32.sub
     local.set $5
     i32.const 0
     local.get $4
     i32.sub
     local.get $4
     local.get $4
     i32.const 0
     i32.lt_s
     select
     local.tee $4
     local.get $0
     local.get $0
     local.get $4
     i32.lt_s
     select
     i32.eqz
     br_if $for-break1
     local.get $15
     i32.const 1
     i32.add
     local.set $15
     br $for-loop|1
    end
   end
  end
  i32.const 0
  local.set $4
  i32.const 0
  local.set $0
  loop $for-loop|7
   local.get $0
   local.get $1
   i32.lt_s
   if
    local.get $4
    i32.const 1
    i32.add
    local.get $4
    local.get $14
    local.get $0
    i32.const 2
    i32.shl
    i32.add
    i32.load
    select
    local.set $4
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|7
   end
  end
  local.get $3
  local.get $2
  i32.const 2
  i32.shl
  i32.add
  local.tee $0
  local.get $5
  i32.store
  local.get $0
  local.get $1
  i32.store offset=4
  local.get $0
  local.get $4
  i32.store offset=8
  i32.const 0
 )
)
