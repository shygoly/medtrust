(module
 (type $0 (func (param i32 i32 i32 i32) (result i32)))
 (import "env" "memory" (memory $0 1 1024))
 (global $assembly/power-dr-potential/abi_version i32 (i32.const 1))
 (export "abi_version" (global $assembly/power-dr-potential/abi_version))
 (export "run" (func $assembly/power-dr-potential/run))
 (export "memory" (memory $0))
 (func $assembly/power-dr-potential/run (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (result i32)
  (local $4 i32)
  (local $5 i64)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i64)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i64)
  (local $14 i64)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (local $18 i64)
  (local $19 i64)
  (local $20 i32)
  (local $21 i32)
  (local $22 i32)
  (local $23 i32)
  (local $24 i32)
  (local $25 i32)
  (local $26 i32)
  (local $27 i64)
  (local $28 i64)
  (local $29 i64)
  local.get $1
  i32.const 0
  i32.le_s
  local.get $1
  i32.const 65536
  i32.gt_s
  i32.or
  if
   i32.const 1
   return
  end
  local.get $2
  i32.const 24
  i32.ne
  if
   i32.const 2
   return
  end
  local.get $0
  i64.load32_s offset=8
  local.set $13
  local.get $0
  i64.load32_s offset=12
  local.set $14
  local.get $0
  i32.load offset=16
  local.set $11
  local.get $0
  i32.load offset=20
  local.set $16
  local.get $0
  i32.load offset=24
  local.set $17
  local.get $0
  i64.load32_s
  local.tee $18
  i64.const 0
  i64.lt_s
  local.get $18
  i64.const 1000
  i64.gt_s
  i32.or
  local.get $0
  i64.load32_s offset=4
  local.tee $19
  i64.const 0
  i64.lt_s
  i32.or
  local.get $19
  i64.const 1000
  i64.gt_s
  i32.or
  if
   i32.const 7
   return
  end
  local.get $13
  i64.const 0
  i64.lt_s
  local.get $13
  i64.const 1000
  i64.gt_s
  i32.or
  local.get $14
  i64.const 0
  i64.lt_s
  i32.or
  local.get $14
  i64.const 1000
  i64.gt_s
  i32.or
  if
   i32.const 7
   return
  end
  local.get $16
  i32.const -1
  i32.lt_s
  local.get $11
  i32.const -1
  i32.lt_s
  i32.or
  local.get $17
  i32.const -1
  i32.lt_s
  i32.or
  if
   i32.const 7
   return
  end
  local.get $0
  i32.const 32
  i32.add
  local.tee $15
  local.get $1
  i32.const 1
  i32.add
  i32.const 2
  i32.shl
  i32.add
  local.set $20
  local.get $15
  i32.load
  local.tee $2
  if
   i32.const 5
   return
  end
  loop $for-loop|0
   local.get $1
   local.get $7
   i32.gt_s
   if
    local.get $15
    local.get $7
    i32.const 1
    i32.add
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.tee $0
    local.get $2
    i32.lt_u
    if
     i32.const 5
     return
    end
    local.get $0
    local.get $2
    i32.sub
    local.tee $2
    i32.const 168
    i32.lt_s
    local.get $2
    i32.const 65536
    i32.gt_s
    i32.or
    if
     i32.const 3
     return
    end
    local.get $2
    i32.const 23
    i32.add
    i32.const 24
    i32.div_s
    local.tee $2
    local.get $4
    i32.gt_s
    if
     local.get $2
     local.set $4
    end
    local.get $0
    local.set $2
    local.get $7
    i32.const 1
    i32.add
    local.set $7
    br $for-loop|0
   end
  end
  local.get $3
  local.get $20
  local.get $2
  i32.const 2
  i32.shl
  i32.add
  i32.const 7
  i32.add
  i32.const -8
  i32.and
  local.tee $8
  local.get $4
  i32.const 2
  i32.shl
  i32.add
  i32.lt_s
  if
   i32.const 6
   return
  end
  loop $for-loop|1
   local.get $1
   local.get $12
   i32.gt_s
   if
    local.get $15
    local.get $12
    i32.const 1
    i32.add
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.get $15
    local.get $12
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.tee $0
    i32.sub
    local.set $21
    local.get $20
    local.get $0
    i32.const 2
    i32.shl
    i32.add
    local.set $22
    local.get $3
    local.get $12
    i32.const 292
    i32.mul
    i32.add
    local.set $10
    i32.const 0
    local.set $2
    i32.const 0
    local.set $7
    loop $for-loop|2
     local.get $7
     local.get $21
     i32.lt_s
     if
      local.get $22
      local.get $7
      i32.const 2
      i32.shl
      i32.add
      i32.load
      local.tee $0
      i32.const 0
      i32.lt_s
      local.get $0
      i32.const 5000000
      i32.gt_s
      i32.or
      if
       i32.const 4
       return
      end
      local.get $0
      local.get $2
      local.get $0
      local.get $2
      i32.gt_s
      select
      local.set $2
      local.get $7
      i32.const 1
      i32.add
      local.set $7
      br $for-loop|2
     end
    end
    i64.const 0
    local.set $9
    i32.const 0
    local.set $7
    loop $for-loop|3
     local.get $7
     i32.const 24
     i32.lt_s
     if
      i32.const 0
      local.set $4
      i64.const 0
      local.set $5
      local.get $7
      local.set $0
      loop $for-loop|4
       local.get $0
       local.get $21
       i32.lt_s
       if
        local.get $8
        local.get $4
        i32.const 2
        i32.shl
        i32.add
        local.get $22
        local.get $0
        i32.const 2
        i32.shl
        i32.add
        i32.load
        local.tee $6
        i32.store
        local.get $5
        local.get $6
        i64.extend_i32_s
        i64.add
        local.set $5
        local.get $4
        i32.const 1
        i32.add
        local.set $4
        local.get $0
        i32.const 24
        i32.add
        local.set $0
        br $for-loop|4
       end
      end
      local.get $4
      i32.const 1
      i32.shr_s
      i32.const 1
      i32.sub
      local.set $6
      loop $for-loop|00
       local.get $6
       i32.const 0
       i32.ge_s
       if
        local.get $6
        local.set $0
        loop $while-continue|0
         local.get $4
         local.get $0
         i32.const 1
         i32.shl
         i32.const 1
         i32.add
         local.tee $23
         i32.gt_s
         if
          local.get $8
          local.get $0
          i32.const 2
          i32.shl
          i32.add
          local.tee $24
          i32.load
          local.tee $25
          local.get $8
          local.get $23
          i32.const 1
          i32.add
          local.tee $0
          local.get $23
          local.get $0
          local.get $4
          i32.lt_s
          if (result i32)
           local.get $8
           local.get $0
           i32.const 2
           i32.shl
           i32.add
           i32.load
           local.get $8
           local.get $23
           i32.const 2
           i32.shl
           i32.add
           i32.load
           i32.gt_s
          else
           i32.const 0
          end
          select
          local.tee $0
          i32.const 2
          i32.shl
          i32.add
          local.tee $23
          i32.load
          local.tee $26
          i32.lt_s
          if
           local.get $24
           local.get $26
           i32.store
           local.get $23
           local.get $25
           i32.store
           br $while-continue|0
          end
         end
        end
        local.get $6
        i32.const 1
        i32.sub
        local.set $6
        br $for-loop|00
       end
      end
      local.get $4
      i32.const 1
      i32.sub
      local.set $6
      loop $for-loop|11
       local.get $6
       i32.const 0
       i32.gt_s
       if
        local.get $8
        i32.load
        local.set $0
        local.get $8
        local.get $8
        local.get $6
        i32.const 2
        i32.shl
        i32.add
        local.tee $23
        i32.load
        i32.store
        local.get $23
        local.get $0
        i32.store
        i32.const 0
        local.set $0
        loop $while-continue|00
         local.get $6
         local.get $0
         i32.const 1
         i32.shl
         i32.const 1
         i32.add
         local.tee $23
         i32.gt_s
         if
          local.get $8
          local.get $0
          i32.const 2
          i32.shl
          i32.add
          local.tee $24
          i32.load
          local.tee $25
          local.get $8
          local.get $23
          i32.const 1
          i32.add
          local.tee $0
          local.get $23
          local.get $0
          local.get $6
          i32.lt_s
          if (result i32)
           local.get $8
           local.get $0
           i32.const 2
           i32.shl
           i32.add
           i32.load
           local.get $8
           local.get $23
           i32.const 2
           i32.shl
           i32.add
           i32.load
           i32.gt_s
          else
           i32.const 0
          end
          select
          local.tee $0
          i32.const 2
          i32.shl
          i32.add
          local.tee $23
          i32.load
          local.tee $26
          i32.lt_s
          if
           local.get $24
           local.get $26
           i32.store
           local.get $23
           local.get $25
           i32.store
           br $while-continue|00
          end
         end
        end
        local.get $6
        i32.const 1
        i32.sub
        local.set $6
        br $for-loop|11
       end
      end
      local.get $10
      local.get $7
      i32.const 2
      i32.shl
      i32.add
      local.get $5
      local.get $4
      i64.extend_i32_s
      i64.div_s
      local.tee $5
      local.get $8
      local.get $4
      i32.const 1
      i32.sub
      i32.const -4
      i32.and
      i32.add
      i64.load32_s
      local.tee $27
      local.get $5
      local.get $27
      i64.lt_s
      select
      local.tee $5
      i64.store32
      local.get $5
      local.get $9
      i64.add
      local.set $9
      local.get $7
      i32.const 1
      i32.add
      local.set $7
      br $for-loop|3
     end
    end
    local.get $9
    i64.const 24
    i64.div_s
    local.set $27
    i32.const 1
    local.set $0
    i32.const 0
    local.set $7
    loop $for-loop|5
     local.get $7
     i32.const 24
     i32.lt_s
     if
      block $for-break5
       local.get $10
       local.get $7
       i32.const 2
       i32.shl
       i32.add
       i64.load32_s
       i64.const 100
       i64.mul
       local.get $2
       i64.extend_i32_s
       i64.const 98
       i64.mul
       i64.lt_s
       if
        i32.const 0
        local.set $0
        br $for-break5
       end
       local.get $7
       i32.const 1
       i32.add
       local.set $7
       br $for-loop|5
      end
     end
    end
    i32.const 0
    local.set $2
    loop $for-loop|6
     local.get $2
     i32.const 24
     i32.lt_s
     if
      local.get $10
      local.get $2
      i32.const 2
      i32.shl
      i32.add
      i64.load32_s
      local.set $28
      local.get $10
      local.get $2
      i32.const 24
      i32.add
      i32.const 2
      i32.shl
      i32.add
      local.get $0
      if (result i64)
       i64.const 0
      else
       local.get $18
       local.get $28
       i64.mul
       i64.const 1000
       i64.div_s
       local.set $5
       local.get $27
       local.get $28
       i64.gt_s
       if
        local.get $5
        local.get $13
        i64.mul
        i64.const 1000
        i64.div_s
        local.set $5
       end
       local.get $11
       i64.extend_i32_s
       local.tee $9
       local.get $16
       i64.extend_i32_s
       local.tee $29
       local.get $5
       local.get $16
       i32.const 0
       i32.ge_s
       local.get $5
       local.get $29
       i64.gt_s
       i32.and
       select
       local.tee $5
       local.get $11
       i32.const 0
       i32.ge_s
       local.get $5
       local.get $9
       i64.gt_s
       i32.and
       select
       local.get $14
       i64.mul
       i64.const 1000
       i64.div_s
      end
      i64.store32
      local.get $19
      local.get $27
      i64.mul
      i64.const 1000
      i64.div_s
      local.set $5
      local.get $27
      local.get $28
      i64.lt_s
      if
       local.get $5
       local.get $13
       i64.mul
       i64.const 1000
       i64.div_s
       local.set $5
      end
      local.get $10
      local.get $2
      i32.const 48
      i32.add
      i32.const 2
      i32.shl
      i32.add
      local.get $11
      i64.extend_i32_s
      local.tee $9
      local.get $17
      i64.extend_i32_s
      local.tee $29
      local.get $5
      local.get $17
      i32.const 0
      i32.ge_s
      local.get $5
      local.get $29
      i64.gt_s
      i32.and
      select
      local.tee $5
      local.get $11
      i32.const 0
      i32.ge_s
      local.get $5
      local.get $9
      i64.gt_s
      i32.and
      select
      local.get $14
      i64.mul
      i64.const 1000
      i64.div_s
      i64.store32
      local.get $2
      i32.const 1
      i32.add
      local.set $2
      br $for-loop|6
     end
    end
    local.get $10
    local.get $0
    i32.store offset=288
    local.get $12
    i32.const 1
    i32.add
    local.set $12
    br $for-loop|1
   end
  end
  i32.const 0
 )
)
